from finbase import *
# rebuild helper fns
def cogs(path, scale, year1_onboard=False):
    m,i = MEMBERS[scale], INSURERS[scale]; d={}
    d['infra']=INFRA_MO[path][scale]*12
    if path=='o2': d['fee']=O2_FEE_MO[scale]*12
    d['stack']=SAASSTACK[path][scale]
    d['sup']=m*SUP_MEMBER[path]+i*SUP_INSURER
    d['onb']=m*(ONBOARD_Y1[path] if year1_onboard else ONBOARD_Y1[path]/3)
    d['total']=sum(d.values()); return d
USD=lambda x:f"${x:,.0f}"; PCT=lambda x:f"{x*100:.1f}%"

print("A. EQUAL-SCALE 3-YEAR TCO (identical ramp S1->S2 assumed for all paths)")
print("   Y1 at S1, Y2 midpoint, Y3 at S2.  Pure cost comparison, no revenue.")
print(f"{'':16}{'o2':>16}{'AWS SaaS':>16}{'AWS BYOC':>16}")
tot={}
for p in PATHS:
    y1 = cogs(p,'S1',True)['total'] + ENG_FTE[p]['S1']*250000 + COMPLIANCE[p]['S1'] \
         + BUILD_EM['single'][p]*250000/12 + GATE[p] + ONETIME_FIX[p]
    y2 = (cogs(p,'S1')['total']+cogs(p,'S2')['total'])/2 \
         + (ENG_FTE[p]['S1']+ENG_FTE[p]['S2'])/2*250000 \
         + (COMPLIANCE[p]['S1']+COMPLIANCE[p]['S2'])/2 \
         + (BUILD_EM['consortium'][p]-BUILD_EM['single'][p])*250000/12
    y3 = cogs(p,'S2')['total'] + ENG_FTE[p]['S2']*250000 + COMPLIANCE[p]['S2']
    tot[p]=(y1,y2,y3,y1+y2+y3)
for lbl,idx in [('Year 1',0),('Year 2',1),('Year 3',2),('3-YR TOTAL',3)]:
    print(f"  {lbl:14}"+"".join(f"{USD(tot[p][idx]):>16}" for p in PATHS))
print(f"  {'vs o2':14}"+"".join(f"{USD(tot[p][3]-tot['o2'][3]):>16}" for p in PATHS))
# 5-year extension
print("\n   5-year extension (Y4 midpoint S2->S3, Y5 at S3):")
tot5={}
for p in PATHS:
    y4=(cogs(p,'S2')['total']+cogs(p,'S3')['total'])/2+(ENG_FTE[p]['S2']+ENG_FTE[p]['S3'])/2*250000+(COMPLIANCE[p]['S2']+COMPLIANCE[p]['S3'])/2
    y5=cogs(p,'S3')['total']+ENG_FTE[p]['S3']*250000+COMPLIANCE[p]['S3']
    tot5[p]=tot[p][3]+y4+y5
print(f"  {'5-YR TOTAL':14}"+"".join(f"{USD(tot5[p]):>16}" for p in PATHS))
print(f"  {'vs o2':14}"+"".join(f"{USD(tot5[p]-tot5['o2']):>16}" for p in PATHS))

print("\nB. CUSTOMER-SIDE 3-YEAR TCO, consortium-wide (same ramp)")
for p in PATHS:
    y1=MEMBERS['S1']*((0 if p=='saas' else MEM_NODE_OWNED['S1'])+(MEM_EGRESS_SAAS['S1'] if p=='saas' else 0)+MEM_COMPLY_Y1[p])
    y2=24*((0 if p=='saas' else MEM_NODE_OWNED['S2'])+(MEM_EGRESS_SAAS['S2'] if p=='saas' else 0)+MEM_COMPLY_REC[p])+16*MEM_COMPLY_Y1[p]
    y3=MEMBERS['S2']*((0 if p=='saas' else MEM_NODE_OWNED['S2'])+(MEM_EGRESS_SAAS['S2'] if p=='saas' else 0)+MEM_COMPLY_REC[p])+16*MEM_COMPLY_Y1[p]
    print(f"  {LABEL[p]:24} Y1 {USD(y1):>12}  Y2 {USD(y2):>12}  Y3 {USD(y3):>12}  3YR {USD(y1+y2+y3):>14}")

print("\nC. TOTAL SYSTEM COST (vendor + all members) 3-yr, equal ramp")
for p in PATHS:
    y1=MEMBERS['S1']*((0 if p=='saas' else MEM_NODE_OWNED['S1'])+(MEM_EGRESS_SAAS['S1'] if p=='saas' else 0)+MEM_COMPLY_Y1[p])
    y2=24*((0 if p=='saas' else MEM_NODE_OWNED['S2'])+(MEM_EGRESS_SAAS['S2'] if p=='saas' else 0)+MEM_COMPLY_REC[p])+16*MEM_COMPLY_Y1[p]
    y3=MEMBERS['S2']*((0 if p=='saas' else MEM_NODE_OWNED['S2'])+(MEM_EGRESS_SAAS['S2'] if p=='saas' else 0)+MEM_COMPLY_REC[p])+16*MEM_COMPLY_Y1[p]
    print(f"  {LABEL[p]:24} vendor {USD(tot[p][3]):>13} + member {USD(y1+y2+y3):>13} = {USD(tot[p][3]+y1+y2+y3):>14}")

print("\nD. COST PER MEMBER-YEAR DELIVERED (vendor cost / member-years, equal-scale 3yr)")
myrs = 8+24+40
for p in PATHS:
    print(f"  {LABEL[p]:24}{USD(tot[p][3]/myrs):>14} per member-year")

print("\nE. MONTHS TO CASH-FLOW POSITIVE (path-specific ramp, monthly run-rate basis)")
print("   Month at which annualised revenue exceeds annualised total cost:")
for p in PATHS:
    for m in [40,60,80,120,200,250]:
        sc='S2' if m<=40 else 'S3'
        rev=m*MEM_ACV[sc]+(6 if m<=40 else 15)*(500000 if m<=40 else 600000)
        c=cogs(p,sc)['total']*(m/MEMBERS[sc])+ENG_FTE[p][sc]*250000+COMPLIANCE[p][sc]+520000
        if rev>c:
            print(f"  {LABEL[p]:24} profitable at ~{m} members (rev {USD(rev)} vs cost {USD(c)})"); break
    else: print(f"  {LABEL[p]:24} not profitable within tested range")
