from finbase import *
USD=lambda x:f"${x:,.0f}"

print("=== I. THIRD DOUBLE COUNT: GATE overlaps COMPLIANCE['S1'] ===")
print("  gtm 'pre-revenue gate' = SOC2 TypeII + pen test + cyber liability + legal")
print("  compliance S1 annual   = platform + TypeI + TypeII + pen test + cyber liability + legal")
print("  year_pnl Yr1 charges BOTH.\n")
for p in PATHS:
    print(f"  {LABEL[p]:24} GATE {USD(GATE[p]):>10} + COMPLIANCE S1 {USD(COMPLIANCE[p]['S1']):>12}"
          f" = {USD(GATE[p]+COMPLIANCE[p]['S1']):>12}  <-- overlap ~{USD(GATE[p])}")

print("\n=== J. ALL THREE DOUBLE COUNTS REMOVED: 3-yr cumulative net on the realistic ramp ===")
pub_net={'o2':-6759432,'saas':-11616481,'byoc':-9887042}
build_dc={'o2':682292,'saas':942708,'byoc':1244792}
print(f"{'':26}{'published':>16}{'-build DC':>16}{'-gate DC':>16}{'corrected':>16}")
corr={}
for p in PATHS:
    c=pub_net[p]+build_dc[p]+GATE[p]; corr[p]=c
    print(f"  {LABEL[p]:24}{USD(pub_net[p]):>16}{USD(pub_net[p]+build_dc[p]):>16}"
          f"{USD(pub_net[p]+build_dc[p]+GATE[p]):>16}{USD(c):>16}")
print(f"\n  o2-vs-saas 3yr gap : published {USD(pub_net['o2']-pub_net['saas'])}"
      f" -> corrected {USD(corr['o2']-corr['saas'])}")
print(f"  o2-vs-byoc 3yr gap : published {USD(pub_net['o2']-pub_net['byoc'])}"
      f" -> corrected {USD(corr['o2']-corr['byoc'])}  ({(corr['o2']-corr['byoc'])/(pub_net['o2']-pub_net['byoc'])-1:+.0%})")

print("\n=== K. saas-stack CI/CD table does not reconcile (inherited by ENV_MATRIX subtraction) ===")
rows={'S1':(180,3624,1208,204,4008,1508),'S2':(1044,25920,8640,204,27168,10140),
      'S3':(6900,10884,3628,204,17988,10528)}
for s,(prod,env,conn,ecr,aws_stated,o2_stated) in rows.items():
    print(f"  {s}: AWS parts {prod}+{env}+{conn}+{ecr} = {prod+env+conn+ecr:>6} vs stated {aws_stated:>6}"
          f"  | o2 parts {prod}+{conn} = {prod+conn:>6} vs stated {o2_stated:>6}")

print("\n=== L. BREAK-EVEN table vs RAMP: direct contradiction ===")
print("  break-even table: o2 = 46.2 members; write-up says 'crossed Year 4'")
print("  ramp Yr4 = 110 members (2.4x break-even) and net is -$824,691")
print("  -> break-even excludes growth CAC; the two tables measure different things")
print("  -> 'with 6 insurers signed -> 5.1 members' is INFEASIBLE: the >=8-contributor")
print("     gate means no sector percentile exists at 5 members, so no insurer can buy.")

print("\n=== M. Cash-burn-before-first-invoice understated (salary only, gate excluded) ===")
for p,team,mo in [('o2',3,9),('byoc',4,10.5),('saas',4,17.5)]:
    sal=team*mo*250000/12
    print(f"  {LABEL[p]:24} salary {USD(sal):>12} + gate {USD(GATE[p]):>10} + fix {USD(ONETIME_FIX[p]):>8}"
          f" = {USD(sal+GATE[p]+ONETIME_FIX[p]):>12}   (write-up quotes {USD(sal)})")
