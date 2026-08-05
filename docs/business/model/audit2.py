from finbase import *
USD=lambda x:f"${x:,.0f}"; PCT=lambda x:f"{x*100:.1f}%"
def cogs(p,s,y1=False):
    m,i=MEMBERS[s],INSURERS[s]; t=INFRA_MO[p][s]*12
    if p=='o2': t+=O2_FEE_MO[s]*12
    t+=SAASSTACK[p][s]+m*SUP_MEMBER[p]+i*SUP_INSURER
    t+=m*(ONBOARD_Y1[p] if y1 else ONBOARD_Y1[p]/3); return t

print("=== C. EQUAL-SCALE 3-YR TCO: as published / minus double-count / plus omitted S&M ===")
pub={'o2':8101432,'saas':10966536,'byoc':10744111}
dc={'o2':682292,'saas':942708,'byoc':1244792}
sm={p:40*CAC_MEMBER[p]+6*CAC_INSURER[p] for p in PATHS}   # 40 members+6 insurers acquired over the 3 yrs
print(f"{'':26}{'published':>15}{'-double count':>15}{'+S&M omitted':>15}{'corrected':>15}")
corr={}
for p in PATHS:
    c=pub[p]-dc[p]+sm[p]; corr[p]=c
    print(f"  {LABEL[p]:24}{USD(pub[p]):>15}{USD(pub[p]-dc[p]):>15}{USD(sm[p]):>15}{USD(c):>15}")
print(f"\n  gap vs o2 -- published : saas {USD(pub['saas']-pub['o2'])}  byoc {USD(pub['byoc']-pub['o2'])}")
print(f"  gap vs o2 -- corrected : saas {USD(corr['saas']-corr['o2'])}  byoc {USD(corr['byoc']-corr['o2'])}")

print("\n=== D. COMBINED STRESS: compliance = wash (all = o2 level) AND o2/byoc support 1.5x ===")
for label,compl_wash,supmult in [("as published",False,1.0),
                                  ("compliance a wash",True,1.0),
                                  ("compliance wash + o2/byoc support 1.5x",True,1.5)]:
    row={}
    for p in PATHS:
        m=MEMBERS['S2']; sm_=supmult if p!='saas' else 1.0
        t=INFRA_MO[p]['S2']*12+(O2_FEE_MO['S2']*12 if p=='o2' else 0)+SAASSTACK[p]['S2']
        t+=m*SUP_MEMBER[p]*sm_+6*SUP_INSURER+m*ONBOARD_Y1[p]/3
        t+=ENG_FTE[p]['S2']*250000
        t+=COMPLIANCE['o2']['S2'] if compl_wash else COMPLIANCE[p]['S2']
        row[p]=t
    print(f"  {label:40}"+"".join(f"{USD(row[p]):>15}" for p in PATHS)
          +f"   | o2 vs saas {USD(row['saas']-row['o2']):>12}")

print("\n=== E. CHURN ABSENT: o2 Yr5 profit at 93-95% GRR ===")
for grr in [1.00,0.95,0.93]:
    lost=int(round(250*(1-grr)))
    extra=lost*CAC_MEMBER['o2']
    print(f"  GRR {PCT(grr)}: ~{lost} members lost/yr -> {USD(extra)} extra CAC "
          f"-> Yr5 net {USD(1715179-extra)}")

print("\n=== F. Yr5 o2 S&M implies how many AE units? (gtm: 7.2 logos/yr/unit) ===")
for yr,(prev,cur) in enumerate([((0,0),(5,0)),((5,0),(18,0)),((18,0),(40,6)),((40,6),(110,10)),((110,10),(250,15))],1):
    new=cur[0]-prev[0]
    print(f"  Yr{yr}: +{new:3} members -> {new/7.2:5.1f} AE units needed (@ $520k each = {USD(new/7.2*520000)})")

print("\n=== G. omitted: member-side shipper agent on the CENTRALISED path ===")
for est in [5000,8000]:
    print(f"  @ {USD(est)}/member/yr -> S2 consortium {USD(est*40)}/yr, "
          f"S2 member total {USD(43976)} -> {USD(43976+est)} (o2 is {USD(24440)})")

print("\n=== H. omitted sensitivity: 1x (uncompressed) member egress on centralised path ===")
print(f"  10x compressed (modelled): S2 {USD(498*12)}/member/yr -> consortium {USD(498*12*40)}")
print(f"  1x raw (aws-byoc says real): S2 {USD(4690*12)}/member/yr -> consortium {USD(4690*12*40)}")
