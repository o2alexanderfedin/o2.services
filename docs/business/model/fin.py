#!/usr/bin/env python3
"""
Consolidated 3-year financial model: o2 vs AWS multi-tenant SaaS vs AWS BYOC.
Detection-Efficacy & Sighting Consortium.  All inputs traced to a named researcher.
"""
from textwrap import indent

USD = lambda x: f"${x:,.0f}"
PCT = lambda x: f"{x*100:.1f}%"

PATHS = ['o2', 'saas', 'byoc']
LABEL = {'o2': 'o2 on-prem', 'saas': 'AWS multi-tenant SaaS', 'byoc': 'AWS BYOC (School A)'}
SCALES = ['S1', 'S2', 'S3']

# ============================================================ SCALE DEFINITION
MEMBERS  = {'S1': 8,  'S2': 40, 'S3': 250}
INSURERS = {'S1': 0,  'S2': 6,  'S3': 15}
ENDUSERS = {'S1': 32000, 'S2': 480000, 'S3': 2250000}
MEM_ACV  = {'S1': 65000, 'S2': 90000, 'S3': 85000}     # gtm blended
INS_ACV  = {'S1': 0,     'S2': 500000, 'S3': 600000}   # gtm

REV = {s: MEMBERS[s]*MEM_ACV[s] + INSURERS[s]*INS_ACV[s] for s in SCALES}
TENANTS = {s: MEMBERS[s]+INSURERS[s] for s in SCALES}

FTE_COST = 250_000      # dev-cost: verified fully-loaded US senior engineer
SUP_FTE_COST = 220_000  # gtm: fully-loaded support engineer

# ================================================== VENDOR INFRASTRUCTURE $/mo
# o2      : o2-operations  (backbone + enrollment + CI + collector + pinning + naming)
# byoc    : aws-byoc       (control plane, verified AWS unit prices)
# saas    : aws-infra      (verified AWS Price List bulk API, supersedes aws-saas)
INFRA_MO = {
    'o2':   {'S1': 504,  'S2': 881,   'S3': 1505},
    'byoc': {'S1': 700,  'S2': 1400,  'S3': 6700},
    'saas': {'S1': 1052, 'S2': 7486,  'S3': 32977},
}

# o2 platform commercial licence: per-node anchor, $20/node/mo midpoint of the
# $10-30 band (o2-operations).  Nodes = members x cluster size + backbone.
O2_NODES = {'S1': 8*3 + 5, 'S2': 40*5 + 9 + 6, 'S3': int(250*4.6) + 15 + 15}
O2_FEE_MO = {s: O2_NODES[s]*20 for s in SCALES}

# ============================================================= SAAS STACK $/yr
# saas-stack researcher.  o2 = their Column C; byoc = Column B (cost-optimal AWS,
# includes full deployment-target CI matrix); saas = Column B minus the
# member-environment matrix, which a centralised vendor does not run.
ENV_MATRIX = {'S1': 3624, 'S2': 25920, 'S3': 10884}
SAASSTACK = {
    'o2':   {'S1': 3122, 'S2': 22158, 'S3': 43881},
    'byoc': {'S1': 5456, 'S2': 38777, 'S3': 52593},
    'saas': {s: 5456 if s=='S1' else (38777 if s=='S2' else 52593) for s in SCALES},
}
for s in SCALES:
    SAASSTACK['saas'][s] -= ENV_MATRIX[s]

# ======================================================= ENGINEERING FTE (R&D)
# dev-cost totals MINUS their customer-support line, so support is not counted
# twice (it is costed separately below from gtm's escalation-based derivation).
ENG_FTE = {
    'o2':   {'S1': 3.5, 'S2': 9.2,   'S3': 14.5},
    'byoc': {'S1': 5.0, 'S2': 11.15, 'S3': 19.5},
    'saas': {'S1': 4.5, 'S2': 10.5,  'S3': 17.5},
}

# ============================================================ COMPLIANCE $/yr
# compliance researcher, vendor balance sheet, full stack incl. insurance
COMPLIANCE = {
    'o2':   {'S1': 137_000, 'S2': 383_500,   'S3': 781_000},
    'byoc': {'S1': 181_000, 'S2': 555_000,   'S3': 1_120_000},
    'saas': {'S1': 475_000, 'S2': 1_355_500, 'S3': 2_847_000},
}

# ==================================================== SUPPORT / CS (per unit)
# gtm bottom-up: escalations/yr x hours x $110/hr loaded + CSM + re-review
SUP_MEMBER = {'o2': 15_600, 'byoc': 21_010, 'saas': 11_380}
SUP_INSURER = 20_000                       # all paths; 3 named users, feed only
ONBOARD_Y1 = {'o2': 9_000, 'byoc': 13_200, 'saas': 6_000}
ONBOARD_AMORT = {p: ONBOARD_Y1[p]/3 for p in PATHS}

# ============================ VARIABLE (per-member) VENDOR INFRA, steady state
# o2   : backbone steps ~1 node per 25 members  -> gtm $72/member/yr
# byoc : control plane $25-45/member/mo         -> gtm $420/member/yr
# saas : derived from aws-infra S2 line items.  Telemetry-variable lines at S2 =
#        EMR 500 + S3 storage 4802 + requests/Glue 21 + archive 2 + Athena 100
#        + KMS 67 + Secrets 40 = $5,532/mo over 40 members = $138.30/mo,
#        x12 = $1,660 + 7% Business Support = $1,776 -> round $1,750
INFRA_PER_MEMBER = {'o2': 72, 'byoc': 420, 'saas': 1_750}
O2_FEE_PER_MEMBER = {'S1': 3*20*12, 'S2': 5*20*12, 'S3': int(4.6*20*12)}

# ============================================================== CAC (from gtm)
CAC_MEMBER  = {'o2': 79_400, 'byoc': 84_800, 'saas': 186_500}
CAC_INSURER = {'o2': 184_400, 'byoc': 184_400, 'saas': 369_000}

# ================================================= BUILD COST (from dev-cost)
BUILD_EM = {
    'single': {'o2': 15.0, 'saas': 25.0, 'byoc': 23.0},
    'consortium': {'o2': 32.75, 'saas': 45.25, 'byoc': 59.75},
    'parity': {'o2': 49.25, 'saas': 67.25, 'byoc': 78.75},
}
EM_COST = 250_000/12    # $20,833/engineer-month
# pre-revenue compliance gate (gtm midpoints) + one-time fixes
GATE = {'o2': 140_000, 'byoc': 155_000, 'saas': 302_000}
ONETIME_FIX = {'o2': 18_000, 'byoc': 0, 'saas': 0}   # compliance: enrollment gaps
                                                      # BYOC DKG is inside its 41 EM

# ===================================================== MEMBER (customer) COST
MEM_NODE_OWNED = {'S1': 15_440, 'S2': 15_440, 'S3': 17_500}   # on-prem-economics
MEM_NODE_CLOUD = {'S1': 52_000, 'S2': 76_300, 'S3': 90_000}   # dedicated cloud
MEM_EGRESS_SAAS = {'S1': 162*12, 'S2': 498*12, 'S3': 373*12}  # raw telemetry out
MEM_COMPLY_Y1 = {'o2': 26_500, 'byoc': 39_000, 'saas': 129_500}
MEM_COMPLY_REC = {'o2': 9_000, 'byoc': 13_500, 'saas': 38_000}


def marginal_cost_to_serve(path, scale='S2'):
    """Vendor's fully-variable annual cost of the Nth MEMBER."""
    c = {}
    c['infra'] = INFRA_PER_MEMBER[path]
    c['platform fee'] = O2_FEE_PER_MEMBER[scale] if path == 'o2' else 0
    c['support'] = SUP_MEMBER[path]
    c['onboarding (1/3)'] = ONBOARD_AMORT[path]
    c['total'] = sum(c.values())
    return c


def cogs(path, scale, year1_onboard=False):
    m, i = MEMBERS[scale], INSURERS[scale]
    d = {}
    d['infrastructure'] = INFRA_MO[path][scale]*12
    if path == 'o2':
        d['o2 platform fee'] = O2_FEE_MO[scale]*12
    d['SaaS stack'] = SAASSTACK[path][scale]
    d['support & CS'] = m*SUP_MEMBER[path] + i*SUP_INSURER
    d['onboarding'] = m*(ONBOARD_Y1[path] if year1_onboard else ONBOARD_AMORT[path])
    d['total'] = sum(d.values())
    return d


def opex(path, scale):
    d = {}
    d['engineering (R&D)'] = ENG_FTE[path][scale]*FTE_COST
    d['compliance'] = COMPLIANCE[path][scale]
    return d


# ==========================================================================
print("="*78)
print("1.  BUILD COST TO A SELLABLE v1  (one-time, VENDOR)")
print("="*78)
hdr = f"{'':38}" + "".join(f"{LABEL[p][:20]:>20}" for p in PATHS)
print(hdr)
for milestone in ['single', 'consortium', 'parity']:
    name = {'single':'Engineering EM - single-player v1',
            'consortium':'Engineering EM - consortium v1',
            'parity':'Engineering EM - parity'}[milestone]
    print(f"{name:38}" + "".join(f"{BUILD_EM[milestone][p]:>20.2f}" for p in PATHS))
for milestone in ['single', 'consortium']:
    name = {'single':'  $ at $20,833/EM (single-player)',
            'consortium':'  $ at $20,833/EM (consortium)'}[milestone]
    print(f"{name:38}" + "".join(f"{USD(BUILD_EM[milestone][p]*EM_COST):>20}" for p in PATHS))
print(f"{'Pre-revenue compliance gate':38}" + "".join(f"{USD(GATE[p]):>20}" for p in PATHS))
print(f"{'One-time security fixes':38}" + "".join(f"{USD(ONETIME_FIX[p]):>20}" for p in PATHS))
tot_single = {p: BUILD_EM['single'][p]*EM_COST + GATE[p] + ONETIME_FIX[p] for p in PATHS}
tot_cons = {p: BUILD_EM['consortium'][p]*EM_COST + GATE[p] + ONETIME_FIX[p] for p in PATHS}
print(f"{'TOTAL to sellable single-player v1':38}" + "".join(f"{USD(tot_single[p]):>20}" for p in PATHS))
print(f"{'TOTAL to consortium v1':38}" + "".join(f"{USD(tot_cons[p]):>20}" for p in PATHS))

# ==========================================================================
print()
print("="*78)
print("2.  MONTHLY RUN-RATE AT EACH SCALE  (steady state)")
print("="*78)
for scale in SCALES:
    print(f"\n--- {scale}: {MEMBERS[scale]} members + {INSURERS[scale]} insurers, "
          f"{ENDUSERS[scale]:,} end users, revenue {USD(REV[scale])}/yr ---")
    rows = ['infrastructure','o2 platform fee','SaaS stack','support & CS',
            'onboarding','engineering (R&D)','compliance']
    data = {}
    for p in PATHS:
        c = cogs(p, scale); o = opex(p, scale)
        merged = {**{k:v for k,v in c.items() if k!='total'}, **o}
        data[p] = merged
    print(f"{'VENDOR $/month':30}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
    for r in rows:
        vals = [data[p].get(r, 0)/12 for p in PATHS]
        if sum(vals) == 0: continue
        print(f"  {r:28}" + "".join(f"{USD(v):>18}" for v in vals))
    tots = [sum(data[p].values())/12 for p in PATHS]
    print(f"  {'TOTAL VENDOR $/month':28}" + "".join(f"{USD(v):>18}" for v in tots))
    print(f"  {'  ...per paying tenant':28}" + "".join(f"{USD(v/TENANTS[scale]):>18}" for v in tots))
    print(f"  {'  ...per end user':28}" + "".join(f"{v/ENDUSERS[scale]:>18.4f}" for v in tots))
    print(f"  {'  ...as % of revenue':28}" + "".join(f"{PCT(v*12/REV[scale]):>18}" for v in tots))
    # customer side
    print(f"{'MEMBER (customer) $/month':30}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
    mem = {}
    for p in PATHS:
        node = 0 if p=='saas' else MEM_NODE_OWNED[scale]
        egr = MEM_EGRESS_SAAS[scale] if p=='saas' else 0
        mem[p] = {'nodes+ops (owned hw)': node, 'raw telemetry egress': egr,
                  'compliance (recurring)': MEM_COMPLY_REC[p]}
    for r in ['nodes+ops (owned hw)','raw telemetry egress','compliance (recurring)']:
        print(f"  {r:28}" + "".join(f"{USD(mem[p][r]/12):>18}" for p in PATHS))
    mtot = {p: sum(mem[p].values()) for p in PATHS}
    print(f"  {'TOTAL per member $/month':28}" + "".join(f"{USD(mtot[p]/12):>18}" for p in PATHS))
    print(f"  {'  x members, $/month':28}" + "".join(f"{USD(mtot[p]*MEMBERS[scale]/12):>18}" for p in PATHS))
    print(f"  {'END USER $/month':28}" + "".join(f"{'$0':>18}" for p in PATHS))

# ==========================================================================
print()
print("="*78)
print("4.  GROSS MARGIN + MARGINAL COST TO SERVE THE Nth CUSTOMER")
print("="*78)
print("\nMarginal annual cost of the Nth MEMBER (vendor, at S2 cluster sizing):")
print(f"{'':26}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
mc = {p: marginal_cost_to_serve(p) for p in PATHS}
for k in ['infra','platform fee','support','onboarding (1/3)','total']:
    print(f"  {k:24}" + "".join(f"{USD(mc[p][k]):>18}" for p in PATHS))
print(f"  {'as % of $90k ACV':24}" + "".join(f"{PCT(mc[p]['total']/90000):>18}" for p in PATHS))
print(f"  {'contribution margin':24}" + "".join(f"{PCT(1-mc[p]['total']/90000):>18}" for p in PATHS))

print("\nGross margin (revenue - COGS; COGS excludes R&D, S&M, compliance):")
print(f"{'':26}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
gm = {}
for scale in SCALES:
    y1 = (scale == 'S1')
    row = []
    for p in PATHS:
        c = cogs(p, scale, year1_onboard=y1)['total']
        g = (REV[scale]-c)/REV[scale]
        gm[(p,scale)] = g
        row.append(g)
    tag = f"  {scale}" + (" (yr-1 onboarding)" if y1 else " (steady state)")
    print(f"{tag:26}" + "".join(f"{PCT(v):>18}" for v in row))
print("\nContribution after compliance (revenue - COGS - compliance):")
for scale in SCALES:
    y1 = (scale=='S1')
    row=[]
    for p in PATHS:
        c = cogs(p, scale, year1_onboard=y1)['total'] + COMPLIANCE[p][scale]
        row.append((REV[scale]-c)/REV[scale])
    print(f"  {scale:24}" + "".join(f"{PCT(v):>18}" for v in row))

# ==========================================================================
print()
print("="*78)
print("5.  CROSSOVER — total vendor cost at equal scale")
print("="*78)
print(f"{'':26}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
for scale in SCALES:
    row = []
    for p in PATHS:
        t = cogs(p, scale)['total'] + sum(opex(p, scale).values())
        row.append(t)
    print(f"  {scale+' total $/yr':24}" + "".join(f"{USD(v):>18}" for v in row))
    best = PATHS[row.index(min(row))]
    print(f"  {'   cheapest':24}{LABEL[best]}   (o2 vs saas delta "
          f"{USD(row[0]-row[1])}, o2 vs byoc {USD(row[0]-row[2])})")
print("\nInfrastructure only (the line most people model):")
for scale in SCALES:
    row=[]
    for p in PATHS:
        v = INFRA_MO[p][scale]*12 + MEMBERS[scale]*INFRA_PER_MEMBER[p]
        if p=='o2': v += O2_FEE_MO[scale]*12
        row.append(v)
    print(f"  {scale:24}" + "".join(f"{USD(v):>18}" for v in row))

# ==========================================================================
print()
print("="*78)
print("7.  BREAK-EVEN MEMBER COUNT (steady state, S2-era cost structure)")
print("="*78)
SM_MAINT = 520_000   # 1 AE+0.5SE unit to replace churn
print(f"{'':30}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
fixed = {}
for p in PATHS:
    f = ENG_FTE[p]['S2']*FTE_COST + COMPLIANCE[p]['S2'] + SAASSTACK[p]['S2'] + SM_MAINT
    f += INFRA_MO[p]['S2']*12 - MEMBERS['S2']*INFRA_PER_MEMBER[p]   # fixed infra part
    if p=='o2':
        f += O2_FEE_MO['S2']*12 - MEMBERS['S2']*O2_FEE_PER_MEMBER['S2']
    fixed[p] = max(f, 0)
print(f"  {'fixed opex $/yr':28}" + "".join(f"{USD(fixed[p]):>18}" for p in PATHS))
print(f"  {'contribution/member $/yr':28}" + "".join(f"{USD(90000-mc[p]['total']):>18}" for p in PATHS))
be = {p: fixed[p]/(90000-mc[p]['total']) for p in PATHS}
print(f"  {'BREAK-EVEN members':28}" + "".join(f"{be[p]:>18.1f}" for p in PATHS))
print(f"  {'  ...with 6 insurers signed':28}" +
      "".join(f"{max((fixed[p]-6*(500000-SUP_INSURER))/(90000-mc[p]['total']),0):>18.1f}" for p in PATHS))

# ==========================================================================
print()
print("="*78)
print("3.  MULTI-YEAR P&L ON PATH-SPECIFIC RAMPS")
print("="*78)
# member/insurer count at END of each year, per path (ESTIMATE from gtm win rates,
# cycle length and time-to-first-invoice)
RAMP = {
  'o2':   [(5,0), (18,0), (40,6), (110,10), (250,15)],
  'byoc': [(0,0), (10,0), (30,3), (85,8),   (200,13)],
  'saas': [(0,0), (3,0),  (12,1), (32,3),   (75,6)],
}
def interp_scale(m):
    """Blend cost parameters by member count between S1/S2/S3 anchors."""
    if m <= 8:  return 'S1'
    if m <= 40: return 'S2'
    return 'S3'

def year_pnl(path, yr, prev, cur):
    pm, pi = prev; cm, ci = cur
    new_m, new_i = max(cm-pm,0), max(ci-pi,0)
    avg_m, avg_i = (pm+cm)/2, (pi+ci)/2
    sc = interp_scale(cm)
    acv_m = MEM_ACV[sc]; acv_i = INS_ACV[sc] if ci else 0
    rev = avg_m*acv_m + avg_i*(acv_i or 500000)
    # COGS
    infra_fixed = INFRA_MO[path][sc]*12 - MEMBERS[sc]*INFRA_PER_MEMBER[path]
    infra = max(infra_fixed,0) + avg_m*INFRA_PER_MEMBER[path]
    fee = 0
    if path=='o2':
        fee = max(O2_FEE_MO[sc]*12 - MEMBERS[sc]*O2_FEE_PER_MEMBER[sc],0) + avg_m*O2_FEE_PER_MEMBER[sc]
    stack = SAASSTACK[path][sc]
    sup = avg_m*SUP_MEMBER[path] + avg_i*SUP_INSURER
    onb = new_m*ONBOARD_Y1[path]
    cogs_t = infra+fee+stack+sup+onb
    # OPEX
    eng_fte = {1: ENG_FTE[path]['S1'], 2: (ENG_FTE[path]['S1']+ENG_FTE[path]['S2'])/2,
               3: ENG_FTE[path]['S2'], 4: (ENG_FTE[path]['S2']+ENG_FTE[path]['S3'])/2,
               5: ENG_FTE[path]['S3']}[yr]
    eng = eng_fte*FTE_COST
    comp = {1: COMPLIANCE[path]['S1'], 2: (COMPLIANCE[path]['S1']+COMPLIANCE[path]['S2'])/2,
            3: COMPLIANCE[path]['S2'], 4:(COMPLIANCE[path]['S2']+COMPLIANCE[path]['S3'])/2,
            5: COMPLIANCE[path]['S3']}[yr]
    sm = new_m*CAC_MEMBER[path] + new_i*CAC_INSURER[path] + 60_000
    build = 0
    if yr==1: build = BUILD_EM['single'][path]*EM_COST + GATE[path] + ONETIME_FIX[path]
    if yr==2: build = (BUILD_EM['consortium'][path]-BUILD_EM['single'][path])*EM_COST
    return dict(rev=rev, cogs=cogs_t, eng=eng, comp=comp, sm=sm, build=build,
                total=cogs_t+eng+comp+sm+build, m=cm, i=ci)

for path in PATHS:
    print(f"\n--- {LABEL[path]} ---")
    print(f"{'Year':>5}{'Members':>9}{'Insurers':>9}{'Revenue':>14}{'COGS':>12}"
          f"{'R&D':>12}{'Compliance':>12}{'S&M':>12}{'Build':>12}{'Total cost':>14}{'Net':>14}")
    cum_r = cum_c = 0
    prev = (0,0)
    for yr in range(1,6):
        cur = RAMP[path][yr-1]
        r = year_pnl(path, yr, prev, cur)
        cum_r += r['rev']; cum_c += r['total']
        print(f"{yr:>5}{r['m']:>9}{r['i']:>9}{USD(r['rev']):>14}{USD(r['cogs']):>12}"
              f"{USD(r['eng']):>12}{USD(r['comp']):>12}{USD(r['sm']):>12}{USD(r['build']):>12}"
              f"{USD(r['total']):>14}{USD(r['rev']-r['total']):>14}")
        if yr==3:
            print(f"{'  3-YR':>5}{'':>9}{'':>9}{USD(cum_r):>14}{'':>12}{'':>12}{'':>12}"
                  f"{'':>12}{'':>12}{USD(cum_c):>14}{USD(cum_r-cum_c):>14}")
        prev = cur
    print(f"{'  5-YR':>5}{'':>9}{'':>9}{USD(cum_r):>14}{'':>12}{'':>12}{'':>12}"
          f"{'':>12}{'':>12}{USD(cum_c):>14}{USD(cum_r-cum_c):>14}")

# ==========================================================================
print()
print("="*78)
print("6.  SENSITIVITY — the three assumptions that move the answer")
print("="*78)

def total_vendor(path, scale, sup_mult=1.0, win_mult=1.0, fee_mult=1.0):
    m = MEMBERS[scale]; i = INSURERS[scale]
    infra = INFRA_MO[path][scale]*12
    fee = O2_FEE_MO[scale]*12*fee_mult if path=='o2' else 0
    stack = SAASSTACK[path][scale]
    sup = (m*SUP_MEMBER[path]*sup_mult) + i*SUP_INSURER
    onb = m*ONBOARD_AMORT[path]
    eng = ENG_FTE[path][scale]*FTE_COST
    comp = COMPLIANCE[path][scale]
    return infra+fee+stack+sup+onb+eng+comp

print("\n(a) Support intensity per member (base o2 $15,600 / SaaS $11,380 / BYOC $21,010)")
print(f"{'':26}" + "".join(f"{LABEL[p][:18]:>18}" for p in PATHS))
for mult, tag in [(0.5,'0.5x'), (1.0,'base'), (2.0,'2.0x')]:
    row = [total_vendor(p,'S2',sup_mult=mult) for p in PATHS]
    print(f"  {'S2 total cost '+tag:24}" + "".join(f"{USD(v):>18}" for v in row))
    row2 = [(REV['S2']-cogs(p,'S2')['total']-(MEMBERS['S2']*SUP_MEMBER[p]*(mult-1)))/REV['S2'] for p in PATHS]
    print(f"  {'  gross margin':24}" + "".join(f"{PCT(v):>18}" for v in row2))

print("\n(b) o2 platform licence fee (base $20/node/mo)")
for mult, tag in [(0.0,'OSS tier -> $0'), (0.5,'$10/node'), (1.0,'$20/node base'), (1.5,'$30/node')]:
    v = total_vendor('o2','S2',fee_mult=mult)
    mcv = mc['o2']['total'] - O2_FEE_PER_MEMBER['S2']*(1-mult)
    print(f"  {tag:24} S2 total {USD(v):>14}   marginal/member {USD(mcv):>10}   "
          f"contribution {PCT(1-mcv/90000)}")

print("\n(c) Centralised-path win rate (base 12%) -> members reached by year 3")
for wr, tag in [(0.06,'6% (0.5x)'), (0.12,'12% base'), (0.24,'24% (2x)')]:
    m3 = int(12 * wr/0.12)
    rev3 = m3*90000
    c = (INFRA_MO['saas']['S2']*12*(m3/40) + SAASSTACK['saas']['S2']
         + m3*SUP_MEMBER['saas'] + m3*ONBOARD_AMORT['saas']
         + ENG_FTE['saas']['S2']*FTE_COST + COMPLIANCE['saas']['S2'])
    print(f"  {tag:24} members {m3:>4}   revenue {USD(rev3):>12}   cost {USD(c):>12}   "
          f"net {USD(rev3-c):>12}")

print("\n(d) Member cost treatment: owned SOC hardware vs dedicated cloud")
print(f"{'':26}" + "".join(f"{'owned':>14}{'cloud':>14}" for _ in ['x']))
for scale in SCALES:
    print(f"  {scale+' per member/yr':24}{USD(MEM_NODE_OWNED[scale]):>14}"
          f"{USD(MEM_NODE_CLOUD[scale]):>14}   "
          f"consortium-wide delta {USD((MEM_NODE_CLOUD[scale]-MEM_NODE_OWNED[scale])*MEMBERS[scale])}")

print("\n(e) AWS silo tenancy demanded by buyers (centralised only, S3)")
for per in [3000, 6200]:
    add = per*TENANTS['S3']
    base = cogs('saas','S3')['total']
    print(f"  ${per}/tenant/yr -> +{USD(add)}   COGS {USD(base)} -> {USD(base+add)}   "
          f"GM {PCT((REV['S3']-base)/REV['S3'])} -> {PCT((REV['S3']-base-add)/REV['S3'])}")

print("\n(f) RAMP SENSITIVITY — 3-yr and 5-yr cumulative net, ramp scaled 0.5x / 1x / 2x")
def run_ramp(path, mult):
    base = RAMP[path]
    ramp = [(int(round(m*mult)), int(round(i*mult))) for (m,i) in base]
    ramp = [(min(m,250), min(i,15)) for (m,i) in ramp]
    prev=(0,0); cr=cc=0; out={}
    for yr in range(1,6):
        cur = ramp[yr-1]
        r = year_pnl(path, yr, prev, cur)
        cr += r['rev']; cc += r['total']
        if yr==3: out['3yr']=(cr,cc,ramp[2][0])
        prev=cur
    out['5yr']=(cr,cc,ramp[4][0])
    return out
print(f"{'':22}{'0.5x ramp':>26}{'base ramp':>26}{'2x ramp':>26}")
for p in PATHS:
    cells=[]
    for mult in [0.5,1.0,2.0]:
        o=run_ramp(p,mult)
        cells.append(f"{USD(o['3yr'][0]-o['3yr'][1])} @{o['3yr'][2]}m")
    print(f"  3-yr net {LABEL[p][:12]:12}" + "".join(f"{c:>26}" for c in cells))
for p in PATHS:
    cells=[]
    for mult in [0.5,1.0,2.0]:
        o=run_ramp(p,mult)
        cells.append(f"{USD(o['5yr'][0]-o['5yr'][1])} @{o['5yr'][2]}m")
    print(f"  5-yr net {LABEL[p][:12]:12}" + "".join(f"{c:>26}" for c in cells))

print("\n(g) CROSS-CHECK: does the model reproduce researcher headline figures?")
print(f"  gtm marginal cost to serve  o2 $13,872 / saas $12,563 / byoc $17,520")
print(f"  this model                  o2 {USD(mc['o2']['total'])} / saas {USD(mc['saas']['total'])} / byoc {USD(mc['byoc']['total'])}")
print(f"  gtm gross margin S2         o2 87.5% / saas 89.5% / byoc 85.7%")
print(f"  this model                  o2 {PCT(gm[('o2','S2')])} / saas {PCT(gm[('saas','S2')])} / byoc {PCT(gm[('byoc','S2')])}")
print(f"  spec engineering @S2 ~$3M   this model R&D+support cash:")
for p in PATHS:
    v = ENG_FTE[p]['S2']*FTE_COST + MEMBERS['S2']*SUP_MEMBER[p] + INSURERS['S2']*SUP_INSURER
    print(f"      {LABEL[p]:24}{USD(v)}")
