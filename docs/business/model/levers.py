#!/usr/bin/env python3
"""What changes the bill: commitment, Graviton, S3 classes, Activate allowances, landmines."""
from model import P, S, SIZ, build, support, tiered, emr_cost, HRS, TB, SCAN_RATES

BASE = {}
for sc in ['S1','S2','S3']:
    L = build(sc); sub = sum(v for k,v in L.items() if not k.startswith('_'))
    BASE[sc] = dict(lines=L, sub=sub, sp=support(sub), tot=sub+support(sub))

def hdr(t): print(f"\n{'='*90}\n{t}\n{'='*90}")

# ---------------------------------------------------------- 1. EMR scan-rate band
hdr("1. EMR SERVERLESS SENSITIVITY — scan rate is the dominant unknown")
print(f"{'scale':6s} {'20 MB/s/core (conservative)':>30s} {'40 (central)':>18s} {'60 (optimistic)':>18s}")
for sc in ['S1','S2','S3']:
    r = S[sc]['read_tb']; out=[]
    for nm in ['conservative','central','optimistic']:
        vh,c = emr_cost(r, SCAN_RATES[nm]); out.append(f"${c:,.0f} ({vh:,.0f} vCPU-h)")
    print(f"{sc:6s} {out[0]:>30s} {out[1]:>18s} {out[2]:>18s}")

# ---------------------------------------------------------- 2. Commitment
hdr("2. ON-DEMAND vs SAVINGS PLANS vs RESERVED INSTANCES")
print("""Compute Savings Plans discount ONLY: AmazonEC2, AWSLambda, AmazonECS(Fargate), AmazonEKS.
Verified by enumerating discountedServiceCode across all 1,074 SP terms in the us-east-1
Compute Savings Plan price list (pub 2026-07-27). ElasticMapReduce is ABSENT.

  => EMR Serverless accepts NO commitment. Aurora Serverless v2 accepts NO reservation
     (RDS RIs cover provisioned instances only). S3 storage has no commitment mechanism.
""")
FG_SP = {'1yr No Upfront':0.212,'1yr All Upfront':0.265,'3yr No Upfront':0.460,'3yr All Upfront':0.510}
print(f"{'scale':6s} {'bill':>10s} {'commitable':>12s} {'% of bill':>10s} "
      f"{'save @1yrNU':>12s} {'save @3yrAU':>12s} {'% bill cut':>11s}")
for sc in ['S1','S2','S3']:
    L=BASE[sc]['lines']
    comm = L['ECS Fargate (control plane, Graviton)'] + L['Lambda (manifest commits, gate, cron)']
    if SIZ[sc]['db']=='rds1az':
        comm += P['rds_t4g_med_1az']*HRS      # RDS RI-able (3yr AU standard ~60.5%)
    tot=BASE[sc]['tot']
    s1=comm*FG_SP['1yr No Upfront']; s3=comm*FG_SP['3yr All Upfront']
    print(f"{sc:6s} ${tot:>9,.0f} ${comm:>11,.0f} {100*comm/tot:>9.1f}% "
          f"${s1:>11,.0f} ${s3:>11,.0f} {100*s3/tot:>10.1f}%")
print("""
Fargate ARM Savings Plan rates (us-east-1 Compute SP price list, pub 2026-07-27):
  on-demand   $0.032380/vCPU-hr   $0.003560/GB-hr
  1yr No Up   $0.025500 (-21.2%)  $0.002800 (-21.3%)
  1yr All Up  $0.023800 (-26.5%)  $0.002610 (-26.7%)
  3yr No Up   $0.017490 (-46.0%)  $0.001920 (-46.1%)
  3yr All Up  $0.015870 (-51.0%)  $0.001740 (-51.1%)
EC2 RI (c7g.4xlarge, standard class) for comparison: 1yr NoUp -34.1%, 3yr AllUp -61.8%.""")

# ---------------------------------------------------------- 3. Graviton
hdr("3. GRAVITON (ARM) vs x86")
print(f"{'service':34s} {'x86 rate':>12s} {'ARM rate':>12s} {'delta':>8s}")
for nm,x,a in [('Fargate vCPU-hr',P['fg_vcpu_x86'],P['fg_vcpu']),
               ('Fargate GB-hr',P['fg_gb_x86'],P['fg_gb']),
               ('EMR Serverless vCPU-hr',0.052624,P['emr_vcpu']),
               ('EMR Serverless GB-hr',0.0057785,P['emr_gb']),
               ('EC2 c7i vs c7g .4xl /hr',0.714,0.58),
               ('Lambda GB-s',0.0000166667,0.0000133334)]:
    print(f"  {nm:32s} ${x:>11.7f} ${a:>11.7f} {100*(a/x-1):>7.1f}%")
print()
for sc in ['S1','S2','S3']:
    L=BASE[sc]['lines']
    arm = L['EMR Serverless (batch monoid map/reduce)']+L['ECS Fargate (control plane, Graviton)']
    x86 = arm/0.8
    print(f"  {sc}: Graviton compute ${arm:,.0f}/mo vs x86 ${x86:,.0f}/mo "
          f"-> saves ${x86-arm:,.0f}/mo = {100*(x86-arm)/BASE[sc]['tot']:.1f}% of bill")

# ---------------------------------------------------------- 4. S3 storage classes
hdr("4. S3 STORAGE CLASSES — the working set is re-read, so 'cheaper' classes lose")
print("""Retrieval-fee classes are priced against bytes RETRIEVED. The 30-day working set is
read ~1.1x its own size per month (237.6 TB read / 216 TB stored at S2) because of the
weekly full 30-day rescan the spec mandates.\n""")
print(f"{'class':26s} {'S1':>12s} {'S2':>12s} {'S3':>12s}   note")
def s3class(sc, cls):
    v=S[sc]; stored=v['comp_tb_mo']*TB; read=v['read_tb']*TB
    if cls=='Standard':      return tiered(stored,P['s3_std']), ''
    if cls=='Standard-IA':   return stored*0.0125 + read*0.01, '99.9% avail, 30-day min'
    if cls=='One Zone-IA':   return stored*0.010 + read*0.01, 'SINGLE AZ - fails durability'
    if cls=='Glacier IR':    return stored*P['s3_gir'] + read*0.03, '90-day min charge'
    if cls=='Intelligent-T': return tiered(stored,P['s3_std']) + v['objects']*0.0025/1000, 'monitoring fee, no gain'
for cls in ['Standard','Standard-IA','One Zone-IA','Glacier IR','Intelligent-T']:
    vals=[s3class(sc,cls) for sc in ['S1','S2','S3']]
    print(f"{cls:26s} "+" ".join(f"${v[0]:>11,.0f}" for v in vals)+f"   {vals[0][1]}")
print("""
BREAK-EVEN: Standard(blended $0.022) = SIA($0.0125 + $0.01*r)  ->  r = 0.95 reads/GB-stored/mo
            Standard(       $0.022) = GIR($0.0040 + $0.03*r)  ->  r = 0.60
Actual r = 1.10.  Standard wins, but only by ~15%. The margin is set entirely by the
weekly full rescan.""")

# ---------------------------------------------------------- 5. The rescan lever
hdr("5. THE SINGLE LARGEST ARCHITECTURAL COST LEVER: drop the weekly full 30-day rescan")
print("""Spec mandates 4 full 30-day rescans/month for late+corrected records. That rescan is
73% of all bytes scanned (172.8 of 237.6 TB at S2) AND it is what pushes r above the
Standard-IA break-even. Iceberg snapshot-incremental reads would absorb late records
instead. Not a free change - it is a spec negotiation - but it should be priced.\n""")
print(f"{'scale':6s} {'EMR now':>10s} {'EMR after':>10s} {'S3 now':>11s} {'S3 after(IA)':>13s} {'total save':>12s} {'% bill':>8s}")
for sc in ['S1','S2','S3']:
    v=S[sc]; stored=v['comp_tb_mo']*TB
    read_now=v['read_tb']; read_new=v['comp_tb_mo']*0.20 + v['comp_tb_mo']*0.10
    _,e_now=emr_cost(read_now,SCAN_RATES['conservative'])
    _,e_new=emr_cost(read_new,SCAN_RATES['conservative'])
    s_now=tiered(stored,P['s3_std']); s_new=stored*0.0125 + read_new*TB*0.01
    sav=(e_now-e_new)+(s_now-s_new)
    print(f"{sc:6s} ${e_now:>9,.0f} ${e_new:>9,.0f} ${s_now:>10,.0f} ${s_new:>12,.0f} "
          f"${sav:>11,.0f} {100*sav/BASE[sc]['tot']:>7.1f}%")

# --------------------------------------------------------- 6. Activate allowance
hdr("6. AWS ACTIVATE ALLOWANCE — realistic effect")
TIERS={'Activate Founders (self-funded, no VC needed)':5_000,
       'Activate Portfolio (mid, via accelerator/VC)':100_000,
       'Activate Portfolio (max)':200_000}
print(f"{'tier':48s} "+" ".join(f"{sc+' months covered':>18s}" for sc in ['S1','S2','S3']))
for nm,amt in TIERS.items():
    row=[]
    for sc in ['S1','S2','S3']:
        # the allowance does NOT cover Support (Enterprise) or RI/SP upfront; Business support assumed eligible
        row.append(f"{amt/BASE[sc]['tot']:>18.1f}")
    print(f"{nm:48s} "+" ".join(row))
print(f"""
Annual AWS spend to cover:  S1 ${BASE['S1']['tot']*12:,.0f}   S2 ${BASE['S2']['tot']*12:,.0f}   S3 ${BASE['S3']['tot']*12:,.0f}

=> A Portfolio-tier startup ($100k) runs the ENTIRE S1 year and most of an S2 year on
   allowance alone. Even Founders tier ($5k, no investor required) covers ~4-5 months at S1.
   The AWS infrastructure bill is effectively $0 for the period in which this product
   must reach first revenue.""")

# ---------------------------------------------------------- 7. Landmines
hdr("7. LATENT COST CLIFFS — recomputed from the shared spec (decimal TB)")
WRITES={'S1':48e9,'S2':720e9,'S3':3375e9}
print(f"{'cliff':52s} {'S1':>14s} {'S2':>14s} {'S3':>14s}")
def row(nm,f):
    print(f"{nm:52s} "+" ".join(f"${f(sc):>13,.0f}" for sc in ['S1','S2','S3']))
row("Bulk over NAT GW instead of free S3 Gateway EP",
    lambda sc: S[sc]['raw_tb_mo']*TB*P['nat_gb'])
row("  same, mitigated by provisioned-bandwidth NAT",
    lambda sc: (S[sc]['raw_tb_mo']*TB*8/(30*24*3600))*HRS*P['nat_prov_gbps_hr'])
row("Per-event 3KB S3 PUTs instead of 256MB objects",
    lambda sc: WRITES[sc]*P['s3_put'])
row("SSE-KMS w/o Bucket Keys, at per-event objects",
    lambda sc: WRITES[sc]*P['kms_req'])
row("Security Lake as AWS-NATIVE source ($0.035/GB)",
    lambda sc: S[sc]['raw_tb_mo']*TB*0.035)
row("CloudWatch: 50 per-tenant metrics (vs 10)",
    lambda sc: tiered(S[sc]['tenants']*50+800, P['cw_metric']))
row("  disciplined baseline actually modelled",
    lambda sc: tiered(SIZ[sc]['cw_metrics'], P['cw_metric']))
row("12-mo RAW compressed archive in Deep Archive",
    lambda sc: 12*S[sc]['comp_tb_mo']*TB*P['s3_gda'])
print(f"\nCORRECT TOTAL BILL for comparison:               "
      +" ".join(f"${BASE[sc]['tot']:>13,.0f}" for sc in ['S1','S2','S3']))

# ---------------------------------------------------------- 8. Stacked best case
hdr("8. STACKED OPTIMISATION — how low can the bill go?")
for sc in ['S1','S2','S3']:
    t=BASE[sc]['tot']; L=BASE[sc]['lines']; v=S[sc]
    comm=L['ECS Fargate (control plane, Graviton)']+L['Lambda (manifest commits, gate, cron)']
    d_sp=comm*FG_SP['3yr All Upfront']
    stored=v['comp_tb_mo']*TB; read_new=v['comp_tb_mo']*0.30
    _,e_now=emr_cost(v['read_tb'],SCAN_RATES['conservative'])
    _,e_new=emr_cost(read_new,SCAN_RATES['central'])
    d_resc=(e_now-e_new)+(tiered(stored,P['s3_std'])-(stored*0.0125+read_new*TB*0.01))
    new=t-d_sp-d_resc
    print(f"  {sc}: ${t:>9,.0f}/mo  -SP ${d_sp:>6,.0f}  -rescan/IA ${d_resc:>8,.0f}"
          f"  => ${new:>9,.0f}/mo  (${new*12:>10,.0f}/yr, -{100*(t-new)/t:.0f}%)")
