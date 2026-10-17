// Two maps from the Explore audit, rebuilt as node maps for the tests: run 1
// (a choice: Heroku or AWS) and run 2 (a cause: why trial signups fell). Each
// line is one node, indented under its parent, as the audit dumped them.

import type { Kind, MapNode, Status } from "../../shared/model.ts";

export const RUN1 = `
- [root] question/answered by claude: Move Heroku to AWS this year? — Weigh migration cost and risk against Heroku's limits for a 10-person team
  - [stay-heroku] option/dropped by you: Stay on Heroku — Keep shipping product; revisit when costs or limits actually hurt
  - [aws-paas] option/dropped by you: AWS via managed PaaS layer — Use App Runner, Fargate or Render/Flightcontrol-style tools for low ops burden
  - [full-aws] option/dropped by you: Full AWS migration — ECS/EKS, RDS, Terraform; most control, needs dedicated ops skills
  - [hybrid] option/chosen by you: Hybrid: move pain points only — Holds narrowly: move only the GPU job; keep web and data on Heroku
    - [h-scope] fact/info by claude: Evidence supports a minimal hybrid — Cost no, limits only GPU, compliance doable on Heroku; nothing else should move
    - [h-audit-scope] fact/info [detail] by claude: Two platforms widen SOC 2 scope — Audit must cover AWS controls too; keep AWS footprint small and Terraformed
    - [h-data-path] question/open by claude: How does GPU job reach data? — Ready to decide: day-old data works, so snapshot is recommended
      - [dp-direct] option/proposed by claude: Direct TLS to Heroku Postgres — Job connects over public internet with sslmode=require; credentials rotate, so fetch at runtime
      - [dp-snapshot] option/proposed by claude: Nightly snapshot export to S3 — Recommended: export needed tables to encrypted S3; job reads it, no live connection
        - [snap-freshness] question/answered by claude: Can the job use day-old data? — Yes: model retrains nightly on yesterday's events; snapshot fits
        - [snap-how] fact/info by claude: Export via scheduled Heroku job — Scheduler runs filtered COPY to S3 with SSE-KMS and a write-only IAM key
        - [snap-retention] fact/info by claude: Expire exports to limit exposure — S3 lifecycle rule deletes snapshots after a few days; auditors like this
      - [dp-peering] option/dropped DROPPED by you: Private Space VPC peering — Private network to AWS VPC; needs Heroku Enterprise Private Spaces, costly ⚠️ verify
      - [dp-cred-fact] fact/info by claude: Heroku rotates DB credentials — DATABASE_URL can change; external consumers must pull it via API ⚠️ verify
      - [dp-minimize-fact] fact/info by claude: Send only the data needed — Exporting only needed columns shrinks the SOC 2 data-flow scope on AWS
    - [h-status] fact/info by claude: Decided vs still open — Decided: narrow hybrid. Open: SOC 2 path, GPU host, data path
    - [h-monday] fact/info by claude: Monday: start audit, scope GPU — Pick Vanta/Drata, book auditor, plan GPU-on-Batch with S3 snapshot
  - [trigger-fact] fact/info by claude: Migrate only for a concrete trigger — Cost, compliance, scale or missing features should justify the move; see trigger checks
  - [ops-fact] fact/info by claude: Ops capacity is the constraint — Full AWS often costs a part-time engineer; small teams feel this
  - [q-trigger] question/answered by claude: Is there a concrete migration trigger? — Yes: compliance is the trigger, plus the GPU job; cost isn't
    - [t-cost] question/answered by claude: Is Heroku spend clearly hurting? — No: $4.2k/mo; AWS savings ~$20k/yr vs ~$30-60k migration ⚠️ verify
      - [t-cost-optimize] fact/info by claude: Trim Heroku before migrating — Right-size 12 Performance dynos and Postgres tier; revisit at ~$8-10k/mo
    - [t-compliance] question/answered by claude: Do customers demand compliance controls? — Yes: 40% of pipeline needs SOC 2 Type II by Q2; one requires EU data
      - [c-soc2-timing] fact/info by claude: Type II window is tight — 3-6 month observation needed; start now; migrating mid-window adds audit risk
      - [c-heroku-eu] fact/info by claude: Heroku offers EU regions — EU Common Runtime and Dublin/Frankfurt Private Spaces may meet residency ⚠️ verify
      - [c-opt-stay] option/proposed by claude: SOC 2 on Heroku first — Recommended: start audit now with Vanta/Drata; EU space for that customer
      - [c-opt-aws] option/proposed by claude: Migrate to AWS before audit — Move fast, then audit on AWS eu-central; risky against Q2 deadline
    - [t-limits] question/answered by claude: Are you hitting technical limits? — Mostly no: only the nightly GPU ML batch job, run by hand
      - [l-gpu-aws] option/proposed by claude: Move GPU job to AWS — Recommended: AWS Batch/ECS GPU on schedule; fits hybrid, covered by SOC 2
      - [l-gpu-automate] option/proposed by claude: Automate GPU job off-AWS — Schedule Lambda Labs or use Modal; cheap, but needs a SOC 2 vendor review
      - [l-gpu-audit] fact/info by claude: Manual box is audit risk — A hand-run box holding prod data will likely be flagged in the SOC 2 audit
    - [t-default] fact/info by claude: No trigger means stay — Without a clear yes, migration costs months and slows product work
`;

export const RUN2 = `
- [root] question/answered by claude: Why did trial signups drop 30%? — Find which funnel stage or external factor caused the monthly decline
  - [opt-traffic] option/chosen by you: Top-of-funnel traffic fell — Holds after challenge: sessions −31%, signups −28–30%, conversion flat, database matches
    - [fact-traffic-split] fact/info by claude: Organic search −52%, others steady — Paid and direct flat, referral −10%; conversion unchanged at 2.1%
    - [q-organic-cause] question/open by claude: Why did organic search collapse? — Rankings, indexing, site change, or SERP/AI overview click loss
      - [opt-org-rank] option/proposed by claude: Ranking loss or algorithm update — Minor factor at most: position barely moved; explains part of impression dip
      - [opt-org-tech] option/dropped by claude: Technical SEO breakage — Unlikely: stable position and impressions rule out indexing or redirect breakage
      - [opt-org-serp] option/proposed [detail] by claude: Fewer clicks from search results — Recommended: most likely cause (~65–70%); CTR collapse on informational queries fits AI overviews
        - [q-confirm-serp] question/open by claude: How to confirm AI overview impact? — Two checks: compare query types, then look at the actual results pages
          - [fact-query-split] fact/info by claude: Split CTR by query intent — If AI overviews: 'what is' queries fall hard, brand/product queries stay flat
          - [fact-serp-check] fact/info by claude: Check top lost queries' SERPs — Look up your 20 biggest losers and note whether an AI overview appears
      - [fact-ctr-collapse] fact/info by claude: CTR fell ~40%, position steady — Clicks −50%, impressions −18%, position 4.1→4.4; losses on 'what is X' posts
      - [q-response] question/open by claude: How to recover lost signups? — Bring back clicks, or replace organic with other channels
        - [opt-resp-bofu] option/proposed by claude: Shift content to buying-intent queries — Comparison, pricing and 'X alternative' pages AI overviews answer less
        - [opt-resp-paid] option/proposed by claude: Backfill with paid or referral — Short-term spend to cover the roughly 30% signup gap while SEO adapts
        - [opt-resp-cite] option/proposed by claude: Get cited inside AI overviews — Structured, quotable answers to win the source links; uplift ⚠️ verify
      - [fact-verdict] fact/info by claude: Best guess: AI overviews, ~65–70% — Strong: drop real, organic-driven, CTR down. Missing: query split and results-page checks
        - [fact-mind-change] fact/info by claude: What would change my mind — Brand queries losing CTR too, no AI overviews on top losers, or other dated cause
    - [fact-mix-shift] fact/info by claude: Mix shift should lift conversion — Fewer low-intent blog visitors should raise blended conversion; flat suggests hidden dip ⚠️ verify
    - [fact-share-check] fact/info by claude: Organic share must be ~60% — Organic −52% only yields sessions −31% if organic was ~60% of traffic ⚠️ verify
  - [opt-conversion] option/dropped by you: Signup conversion rate fell — Pricing page change, new form fields, broken flow, or new messaging
  - [opt-tracking] option/dropped by claude: Measurement or tracking broke — Ruled out: database shows −28%, matching analytics; the drop is real
    - [fact-db-confirms] fact/info by claude: Database confirms the drop — New trial accounts −28% vs last month, analytics −30%: both sources agree
    - [q-signup-gating] question/open by claude: Did signup rules change? — Check for new spam filters, email verification, or account dedup
  - [opt-market] option/dropped by you: Seasonality or market shift — Holidays, budget cycles, a competitor launch, or less demand in the category
  - [fact-decompose] fact/info by claude: Signups = traffic × conversion — Splitting the drop into these two terms quickly isolates the cause
  - [fact-baseline] fact/info by claude: Compare year-over-year and by segment — Same month last year, plus channel, geo, and device splits
`;

const LINE =
  /^( *)- \[([\w.:-]+)\] (question|option|fact)\/(\w+)((?: DROPPED| \[detail\])*) by (you|claude): (.*?) — (.*)$/;

// A dump read back into nodes: indentation gives the parent, line order the
// order, and each node's updatedAt is 1000 plus its line.
export function parseDump(text: string): Record<string, MapNode> {
  const nodes: Record<string, MapNode> = {};
  const stack: { depth: number; id: string }[] = [];
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, indent, id, kind, status, flags, by, title, summary] = m;
    const depth = indent.length / 2;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const order = Object.keys(nodes).length;
    nodes[id] = {
      id,
      parent: stack.length ? stack[stack.length - 1].id : null,
      kind: kind as Kind,
      title,
      summary,
      detail: flags.includes("[detail]") ? "(written)" : "",
      status: status as Status,
      by: by as "you" | "claude",
      updatedAt: 1000 + order,
      order,
      ...(flags.includes("DROPPED") ? { dropped: true } : {}),
    };
    stack.push({ depth, id });
  }
  return nodes;
}
