from finbase import *
USD=lambda x:f"${x:,.0f}"; PCT=lambda x:f"{x*100:.1f}%"

def cogs(path, scale, y1=False):
    m,i=MEMBERS[scale],INSURERS[scale]
    t=INFRA_MO[path][scale]*12
    if path=='o2': t+=O2_FEE_MO[scale]*12
    t+=SAASSTACK[path][scale]
    t+=m*SUP_MEMBER[path]+i*SUP_INSURER
    t+=m*(ONBOARD_Y1[path] if y1 else ONBOARD_Y1[path]/3)
    return t

print("=== A. S2 DRIVER DECOMPOSITION, o2 vs SaaS (write-up claims 972k+325k+79k-775-168.8k-40k) ===")
d={}
d['infra']=(INFRA_MO['saas']['S2']-INFRA_MO['o2']['S2'])*12
d['o2 platform fee']=-O2_FEE_MO['S2']*12
d['SaaS stack']=SAASSTACK['saas']['S2']-SAASSTACK['o2']['S2']
d['support']=40*(SUP_MEMBER['saas']-SUP_MEMBER['o2'])
d['onboarding']=40*(ONBOARD_Y1['saas']-ONBOARD_Y1['o2'])/3
d['engineering']=(ENG_FTE['saas']['S2']-ENG_FTE['o2']['S2'])*250000
d['compliance']=COMPLIANCE['saas']['S2']-COMPLIANCE['o2']['S2']
for k,v in d.items(): print(f"  {k:22}{USD(v):>14}")
print(f"  {'SUM':22}{USD(sum(d.values())):>14}")
actual=(cogs('saas','S2')+ENG_FTE['saas']['S2']*250000+COMPLIANCE['saas']['S2'])-(cogs('o2','S2')+ENG_FTE['o2']['S2']*250000+COMPLIANCE['o2']['S2'])
print(f"  {'ACTUAL GAP':22}{USD(actual):>14}")
print("  WRITE-UP omits the -$51,600 o2 fee line and states stack as -$775 not "
      f"{USD(d['SaaS stack'])}")

print("\n=== B. DOUBLE COUNT: build EM charged on top of full-year FTE salaries ===")
for p in PATHS:
    y1_fte=ENG_FTE[p]['S1']; y1_cap=y1_fte*12
    y1_build=BUILD_EM['single'][p]
    y2_fte=(ENG_FTE[p]['S1']+ENG_FTE[p]['S2'])/2; y2_cap=y2_fte*12
    y2_build=BUILD_EM['consortium'][p]-BUILD_EM['single'][p]
    dc=(y1_build+y2_build)*250000/12
    print(f"  {LABEL[p]:24} Y1 capacity {y1_cap:5.0f} EM vs build {y1_build:5.1f} EM | "
          f"Y2 capacity {y2_cap:5.0f} EM vs build {y2_build:5.1f} EM | DOUBLE-COUNTED {USD(dc)}")
