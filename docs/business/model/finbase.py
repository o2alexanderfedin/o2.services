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


