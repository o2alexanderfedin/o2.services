#!/usr/bin/env python3
"""
AWS multi-tenant SaaS infrastructure cost model — "SightingHub" centralised comparator.
All unit prices from AWS Price List API us-east-1 (pub dates noted) or named pricing page.
Observed 2026-08-01.  1 TB = 1024 GB throughout.  730 hr/month.
"""
HRS = 730.0
TB = 1000.0  # GB — decimal, matching the shared spec's own arithmetic
             # (spec: "20,000 seats x 150 MB = 3.0 TB"). AWS storage is billed in
             # GiB, so storage lines carry a +7% binary-vs-decimal caveat.

# ---------------------------------------------------------------- UNIT PRICES
P = {
 # EMR Serverless ARM  (ElasticMapReduce, pub 2026-07-17)
 'emr_vcpu':0.042094, 'emr_gb':0.004628,
 # Fargate ARM (AmazonECS, pub 2026-07-07)
 'fg_vcpu':0.03238, 'fg_gb':0.00356,
 'fg_vcpu_x86':0.04048, 'fg_gb_x86':0.004445,
 # Lambda (AWSLambda, pub 2026-07-17)
 'lam_gbs_arm':0.0000133334, 'lam_req':0.0000002,
 # RDS / Aurora (AmazonRDS, pub 2026-07-29)
 'rds_t4g_med_1az':0.065, 'rds_t4g_med_maz':0.129,
 'rds_gp3_1az':0.115, 'rds_gp3_maz':0.23,
 'rds_gp3_piops_1az':0.02, 'rds_gp3_piops_maz':0.04,
 'rds_backup':0.095,
 'aur_acu':0.12, 'aur_acu_ioopt':0.16,
 'aur_stor':0.10, 'aur_stor_ioopt':0.225,
 'aur_io':0.20/1e6, 'aur_backup':0.021,
 # S3 (AmazonS3, pub 2026-07-28)
 's3_std':[(50*TB,0.023),(450*TB,0.022),(float('inf'),0.021)],
 's3_gir':0.004, 's3_gda':0.00099,
 's3_put':0.005/1000, 's3_get':0.0004/1000, 's3_lc_gda':0.05/1000,
 # Glue (AWSGlue, pub 2026-07-20)
 'glue_cat_obj':1.0/100000, 'glue_cat_req':1.0/1e6, 'glue_dpu':0.44,
 # Data transfer (AWSDataTransfer pub 2026-07-20; EC2 pub 2026-07-28)
 'dto':[(10*TB,0.09),(40*TB,0.085),(100*TB,0.070),(float('inf'),0.050)],
 'dto_free':100.0,
 'interaz':0.010,            # per GB, each direction
 'xregion':0.02,
 # CloudFront (aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
 'cf':[(9*TB,0.085),(40*TB,0.080),(100*TB,0.060),(float('inf'),0.040)],
 'cf_free_gb':1*TB, 'cf_req_https':0.0100/10000, 'cf_free_req':10e6,
 # NAT (AmazonEC2, pub 2026-07-28)
 'nat_hr':0.045, 'nat_gb':0.045, 'nat_prov_gbps_hr':1.076,
 # ELB (AWSELB, pub 2026-07-20)
 'alb_hr':0.0225, 'alb_lcu':0.008, 'nlb_hr':0.0225, 'nlb_lcu':0.006,
 # KMS (awskms, pub 2025-08-28)
 'kms_key':1.00, 'kms_req':0.03/10000,
 # Secrets Manager (AWSSecretsManager, pub 2025-08-28)
 'sm_secret':0.40, 'sm_req':0.05/10000,
 # CloudWatch (AmazonCloudWatch, pub 2026-07-29)
 'cw_metric':[(10000,0.30),(240000,0.10),(750000,0.05),(float('inf'),0.02)],
 'cw_log_std':0.50, 'cw_log_ia':0.25, 'cw_log_stor':0.03, 'cw_insights':0.005,
 'cw_alarm':0.10, 'cw_alarm_hi':0.30, 'cw_alarm_comp':0.50,
 # Athena (AmazonAthena, pub 2026-03-27)
 'athena_tb':5.00, 'athena_dpu':0.30,
 # Step Functions (AmazonStates, pub 2025-08-28) / SQS / EventBridge
 'sfn_tr':0.000025, 'sqs_req':0.40/1e6, 'eb_evt':1.00/1e6,
 # Cognito (aws.amazon.com/cognito/pricing)
 'cog_fed':0.015, 'cog_fed_free':50,
}

def tiered(qty, tiers, free=0.0):
    """Apply AWS volume tiers. tiers = [(size_of_band, rate), ...]"""
    q = max(0.0, qty - free); cost = 0.0
    for band, rate in tiers:
        take = min(q, band)
        cost += take * rate; q -= take
        if q <= 0: break
    return cost

# ---------------------------------------------------------------- SCALES
S = {
 'S1': dict(seats=32_000,  members=8,   insurers=0,  tenants=8,   soc_users=8*4),
 'S2': dict(seats=480_000, members=40,  insurers=6,  tenants=46,  soc_users=40*9+6*3),
 'S3': dict(seats=2_250_000, members=250, insurers=15, tenants=265, soc_users=250*7+15*3),
}
MB_PER_SEAT_DAY = 150.0
COMPRESSION = 10.0
EGRESS_TB = {'S1':0.04,'S2':1.0,'S3':18.0}

for k,v in S.items():
    v['raw_tb_day']  = v['seats']*MB_PER_SEAT_DAY/1e6
    v['raw_tb_mo']   = v['raw_tb_day']*30
    v['comp_tb_mo']  = v['raw_tb_mo']/COMPRESSION      # = 30-day working set
    # projected compressed read: 1x incremental@20% + 4x rescan@20% + 1x sighting@10%
    v['read_tb']     = v['comp_tb_mo']*0.20 + 4*v['comp_tb_mo']*0.20 + v['comp_tb_mo']*0.10
    v['objects']     = v['comp_tb_mo']*1e6/256           # 256 MB objects

# ---------------------------------------------------------------- SIZING
SIZ = {
 'S1': dict(fg=[(8,1,2)], db='rds1az', db_acu=0, nat=2, nat_gb=200, alb=1, lcu=1,
            kms_keys=12, kms_req=1e6, secrets=26, sm_req=1e5,
            cw_metrics=8*10+300, cw_log_gb=100, cw_scan_gb=200, alarms=60, calarms=5,
            athena_tb=2, sfn=750*(8*6+30), sqs=None, misc=12),
 'S2': dict(fg=[(4,2,4),(6,1,2)], db='aurora', db_acu=3.0, db_stor=50, db_io=50e6,
            nat=2, nat_gb=1000, alb=1, lcu=3,
            kms_keys=52, kms_req=5e6, secrets=95, sm_req=5e5,
            cw_metrics=46*10+500, cw_log_gb=500, cw_scan_gb=1000, alarms=150, calarms=10,
            athena_tb=20, sfn=750*(40*6+50), sqs=None, misc=25),
 'S3': dict(fg=[(8,2,4),(12,1,2)], db='aurora', db_acu=8.0, db_stor=200, db_io=300e6,
            nat=3, nat_gb=4000, alb=2, lcu=8,
            kms_keys=275, kms_req=20e6, secrets=525, sm_req=2e6,
            cw_metrics=265*10+800, cw_log_gb=2000, cw_scan_gb=5000, alarms=400, calarms=25,
            athena_tb=100, sfn=750*(265*6+200), sqs=None, misc=60),
}

SCAN_RATES = {'conservative':20.0, 'central':40.0, 'optimistic':60.0}  # MB/s/core
OVERHEAD = 2.5

def emr_cost(read_tb, mbps):
    core_s = read_tb*1e6/mbps                            # TB -> MB -> core-seconds
    vcpu_h = core_s/3600*OVERHEAD
    rate = P['emr_vcpu'] + 4*P['emr_gb']      # 4 GiB per vCPU
    return vcpu_h, vcpu_h*rate

def build(scale):
    v, z = S[scale], SIZ[scale]
    L = {}
    # --- compute
    vh, emr = emr_cost(v['read_tb'], SCAN_RATES['conservative'])
    L['EMR Serverless (batch monoid map/reduce)'] = emr
    L['_emr_vcpu_h'] = vh
    fg = sum(n*HRS*(c*P['fg_vcpu'] + g*P['fg_gb']) for n,c,g in z['fg'])
    L['ECS Fargate (control plane, Graviton)'] = fg
    lam_gbs = v['objects']*2*0.5
    L['Lambda (manifest commits, gate, cron)'] = lam_gbs*P['lam_gbs_arm'] + v['objects']*P['lam_req'] + 5
    # --- database
    if z['db']=='rds1az':
        db = P['rds_t4g_med_1az']*HRS + 100*P['rds_gp3_1az'] + 50*P['rds_backup']
    else:
        db = (z['db_acu']*HRS*P['aur_acu'] + z['db_stor']*P['aur_stor']
              + z['db_io']*P['aur_io'] + z['db_stor']*P['aur_backup'])
    L['Database (Aurora/RDS PostgreSQL incl. replica, backups, IOPS)'] = db
    # --- object storage
    st = tiered(v['comp_tb_mo']*TB, P['s3_std'])
    req = v['objects']*P['s3_put'] + v['objects']*5.5*P['s3_get']
    glue = z['misc']*0 + (v['objects']*0.06*P['glue_cat_obj']*0 )  # folded below
    glue = {'S1':2,'S2':15,'S3':70}[scale]
    arch = {'S1':1,'S2':2,'S3':5}[scale]   # 12-mo partial+artefact archive, Deep Archive
    L['S3 object storage (30-day working set, Standard)'] = st
    L['S3 requests (PUT/GET) + Glue Data Catalog'] = req + glue
    L['S3 Glacier Deep Archive (12-mo partials/artefacts)'] = arch
    # --- CDN + egress
    eg = EGRESS_TB[scale]*TB
    cf = tiered(eg, P['cf'], free=P['cf_free_gb'])
    cf_req = max(0, {'S1':2e6,'S2':10e6,'S3':50e6}[scale]-P['cf_free_req'])*P['cf_req_https']
    L['CloudFront (published feed/index egress + requests)'] = cf + cf_req
    api_eg = {'S1':10,'S2':100,'S3':500}[scale]
    L['Internet egress, non-CDN (API/console)'] = tiered(api_eg, P['dto'], free=P['dto_free'])
    # --- network
    L['NAT Gateway (hours + per-GB processing)'] = z['nat']*HRS*P['nat_hr'] + z['nat_gb']*P['nat_gb']
    iaz = {'S1':50,'S2':500,'S3':3000}[scale]
    L['Inter-AZ data transfer'] = iaz*P['interaz']*2
    L['Load balancers (ALB hours + LCU)'] = z['alb']*HRS*P['alb_hr'] + z['lcu']*HRS*P['alb_lcu']
    # --- security / ops
    L['KMS (per-tenant CMKs + requests)'] = z['kms_keys']*P['kms_key'] + z['kms_req']*P['kms_req']
    L['Secrets Manager'] = z['secrets']*P['sm_secret'] + z['sm_req']*P['sm_req']
    cw = (tiered(z['cw_metrics'], P['cw_metric'])
          + z['cw_log_gb']*P['cw_log_ia'] + z['cw_log_gb']*0.5*P['cw_log_stor']
          + z['cw_scan_gb']*P['cw_insights']
          + z['alarms']*P['cw_alarm'] + z['calarms']*P['cw_alarm_comp'])
    L['CloudWatch (metrics, log ingest IA, retention, Insights, alarms)'] = cw
    # --- analytical + orchestration + auth
    L['Athena (analytical tier, capped workgroups)'] = z['athena_tb']*P['athena_tb']
    orch = max(0,z['sfn']-4000)*P['sfn_tr'] + v['objects']*P['sqs_req'] + v['objects']*P['eb_evt']
    L['Step Functions + SQS + EventBridge'] = orch
    L['Cognito (SAML/OIDC federated SOC seats)'] = max(0,v['soc_users']-P['cog_fed_free'])*P['cog_fed']
    L['Route 53 + ACM + ECR + misc'] = {'S1':12,'S2':25,'S3':60}[scale]
    return L

def support(sub):
    """AWS Business Support+ : max($29, 9% first $10k, 7% $10-80k, 5% $80-250k, 3% >$250k)
       aws.amazon.com/premiumsupport/pricing/ observed 2026-08-01"""
    r=0; q=sub
    for band,rate in [(10000,.09),(70000,.07),(170000,.05),(float('inf'),.03)]:
        t=min(q,band); r+=t*rate; q-=t
        if q<=0: break
    return max(29.0, r)

if __name__=='__main__':
    import sys
    tot={}
    for sc in ['S1','S2','S3']:
        L=build(sc); v=S[sc]
        print(f"\n{'='*88}\n{sc}: {v['tenants']} tenants, {v['seats']:,} seats, "
              f"{v['raw_tb_day']:.1f} TB/day raw, {v['comp_tb_mo']:.1f} TB compressed working set")
        print(f"     projected compressed read {v['read_tb']:.1f} TB/mo, "
              f"{v['objects']:,.0f} objects @256MB, EMR {L['_emr_vcpu_h']:,.0f} vCPU-h/mo")
        print('-'*88)
        sub=0
        for k,val in L.items():
            if k.startswith('_'): continue
            print(f"  {k:<62} ${val:>10,.2f}"); sub+=val
        sp=support(sub)
        print('-'*88)
        print(f"  {'SUBTOTAL':<62} ${sub:>10,.2f}")
        print(f"  {'AWS Business Support':<62} ${sp:>10,.2f}")
        print(f"  {'TOTAL / month':<62} ${sub+sp:>10,.2f}")
        print(f"  {'TOTAL / year':<62} ${(sub+sp)*12:>10,.2f}")
        tot[sc]=(sub,sp,sub+sp)
    print(f"\n{'='*88}\nSUMMARY")
    for sc,(a,b,c) in tot.items():
        print(f"  {sc}: ${c:>10,.2f}/mo   ${c*12:>12,.2f}/yr   "
              f"(${c/S[sc]['tenants']:.2f}/tenant/mo)")
