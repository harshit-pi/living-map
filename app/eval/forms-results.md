| Question | Fits | Default effort: form · time (first words) | Low effort |
|---|---|---|---|
| How does the TLS handshake set up an encrypted connection? | sequence | sequence · 18s (9.3s) | sequence · 17s (6.6s) |
| How does photosynthesis turn light into sugar? | concept/structure/sequence | sequence · 20s (9.9s) | structure · 20s (7.0s) |
| How did the French Revolution unfold, 1789–1799? | timeline | timeline · 24s (12.2s) | timeline · 13s (1.6s) |
| How does a B-tree index find a row? | structure | structure · 29s (17.7s) | structure · 22s (7.9s) |
| REST vs GraphQL vs gRPC: when to use which? | grid | grid · 20s (8.7s) | grid · 18s (6.2s) |
| How does compound interest grow savings over 30 years? | grid/timeline/concept | timeline · 16s (8.7s) | timeline · 16s (5.2s) |
| What does git rebase do differently from merge? | structure/sequence | structure · 29s (19.1s) | structure · 18s (7.1s) |
| LeetCode 200: Number of Islands | grid/structure | grid · 25s (14.1s) | grid · 15s (5.4s) |
| How does the immune system fight a new virus? | sequence/concept/timeline | sequence · 26s (14.5s) | timeline · 18s (5.6s) |
| How do supply and demand settle a price? | concept/grid | grid · 28s (18.2s) | grid · 15s (5.3s) |
| Bayes' theorem: what does a positive medical test really mean? | grid/concept | structure ✗ · 26s (15.0s) | structure ✗ · 16s (4.7s) |
| How did JavaScript module systems evolve? | timeline | timeline · 22s (12.2s) | timeline · 16s (3.7s) |

Average: default 23.7s (first 13.3s); low 16.9s (first 5.5s).
Fit: default 11/12, low 11/12. Cost $0.99.

### Bayes' theorem: what does a positive medical test really mean? (default)
Steps: How many are actually sick? · Who ends up testing positive? · What share of positives are sick? · How does Bayes' formula say this?

```
form: structure · 1,000 people take the same test (1% have the disease)
- pop: 1,000 people tested [prevalence: 1%; test catches 90% of the sick; 9% of healthy people test + anyway]
- sick: [BLANK sick: "How many of the 1,000 are sick?"]
- healthy: [BLANK healthy: "How many of the 1,000 are healthy?"]
- sick-pos: Sick and test + [count: ?]
- healthy-pos: [BLANK healthy-pos: "How many healthy people test positive?"]
- all-pos: Everyone who tests + [total: ?; share truly sick: ?]
  pop —1% are sick→ sick
  pop —99% are healthy→ healthy
  sick —90% test +→ sick-pos
  healthy —9% test +→ healthy-pos
  sick-pos —all join→ all-pos
  healthy-pos —all join→ all-pos
```

### Bayes' theorem: what does a positive medical test really mean? (low)
Steps: How many are actually sick? · Where do positives come from? · What share of positives are sick? · How does Bayes' formula encode this? · Why does a rare disease mislead?

```
form: structure · 1,000 people: 1% sick, 90% sensitivity, 9% false positives
- pop: 1,000 people tested [disease rate 1%]
- sick: [BLANK sick: "How many of the 1,000 are sick?"]
- healthy: 990 healthy 
- sickpos: Sick, test + [90% of sick]
- sickneg: Sick, test − [10% of sick]
- healthypos: [BLANK healthypos: "How many healthy people test positive?"]
- healthyneg: Healthy, test − [91% of healthy]
- answer: [BLANK answer: "Share of positives who are sick?"]
  pop —splits into→ sick
  pop —splits into→ healthy
  sick —splits into→ sickpos
  sick —splits into→ sickneg
  healthy —splits into→ healthypos
  healthy —splits into→ healthyneg
  sickpos —feeds→ answer
  healthypos —feeds→ answer
```

### How did JavaScript module systems evolve? (default)
Steps: Why did script tags break? · How did CommonJS fix it? · Why did browsers need AMD/bundlers? · What did ES modules change? · Why is CJS/ESM interop painful?

```
form: timeline · Loading math.js (exports add) across the eras
- e1 1995: <script src="math.js">
- e2 2009: [BLANK e2: "How does Node's math.js export add?"]
- e3 2011: [BLANK e3: "Why couldn't browsers just use Node's require?"]
- e4 2011: Browserify / later webpack
- e5 Jun 2015: [BLANK e5: "Write ES2015's export and import of add"]
- e6 2017–18: <script type="module">
- e7 Nov 2019: Node 13.2: "type":"module"
- e8 Dec 2024: Node 22.12: require(esm)
```

### How did JavaScript module systems evolve? (low)
Steps: Why did global scripts break? · How did Node load modules? · Why did browsers need something else? · What made ES modules different? · Why is mixing CJS and ESM painful?

```
form: timeline · One tiny math.js, shared across 20 years
- e1995 1995: <script> tags, globals
- e2009 2009: [BLANK e2009: "How did Node let app.js get add from math.js?"]
- e2011 2011: AMD / RequireJS
- e2012 2011–14: [BLANK e2012: "Which tools let browsers run require() code?"]
- e2015 Jun 2015: [BLANK e2015: "Which syntax did ES2015 standardise?"]
- e2017 2017–18: Browsers ship <script type=module>
- e2019 2019–20: Node supports ESM
```

### How did the French Revolution unfold, 1789–1799? (default)
Steps: Why did 1789 break open? · Why did the monarchy fall by 1792? · Why did the Republic turn to Terror? · How did it end in 1799?

```
form: timeline · France 1789–1799
- e-estates 5 May 1789: Estates-General opens
- e-jun89 Jun 1789: [BLANK e-jun89: "What did the Third Estate declare itself?"]
- e-jul89 14 Jul 1789: [BLANK e-jul89: "What did Paris crowds storm?"]
- e-rights Aug 1789: Declaration of the Rights of Man
- e-jun91 Jun 1791: [BLANK e-jun91: "What did the royal family try to do?"]
- e-war Apr 1792: France declares war on Austria
- e-republic Sep 1792: Monarchy abolished, Republic declared
- e-execution Jan 1793: Louis XVI executed
- e-terror Sep 1793: Terror made 'the order of the day'
- e-thermidor Jul 1794: Robespierre overthrown and guillotined
- e-directory Nov 1795: Directory: five-man executive
- e-brumaire Nov 1799: Brumaire coup: Napoleon takes power
```

### How did the French Revolution unfold, 1789–1799? (low)
Steps: Why did crisis hit in 1789? · How did reform become republic? · Why did the Terror happen? · How did it end with Napoleon?

```
form: timeline · France 1789–1799: key turns
- e1 May 1789: Estates-General meets
- e2 Jun 1789: Tennis Court Oath
- e3 14 Jul 1789: [BLANK e3: "What did Paris crowds storm this day?"]
- e4 Aug 1789: Declaration of the Rights of Man
- e5 Jun 1791: Flight to Varennes
- e6 Sep 1792: [BLANK e6: "What replaced the monarchy this month?"]
- e7 Jan 1793: Louis XVI executed
- e8 Jul 1794: [BLANK e8: "Whose fall ended the Terror?"]
- e9 1795: Directory formed
- e10 Nov 1799: Coup of 18 Brumaire
```

### How do supply and demand settle a price? (default)
Steps: How do buyers react to price? · How do sellers react to price? · Where do wanted and offered meet? · What pushes a wrong price back? · What moves the meeting point?

```
form: grid · Coffee stall, one morning: cups per price
columns: Cups wanted (buyers) | Cups offered (sellers)
- $1 a cup: 100 | 20
- $2 a cup: 80 | 40
- $3 a cup: 60 | [BLANK o3: "How many cups would sellers offer at $3?"]
- $4 a cup: [BLANK w4: "How many cups would buyers want at $4?"] | 80
- $5 a cup: 20 | 100
```

### How do supply and demand settle a price? (low)
Steps: Why do buyers want fewer at higher prices? · Why do sellers offer more at higher prices? · What happens when quantities don't match? · Which way does a gap push price? · What if demand suddenly rises?

```
form: grid · Coffee cups per day at each price
columns: Cups demanded | Cups supplied | Gap (demanded vs supplied)
- $1: 100 | 20 | [BLANK g1: "Shortage or surplus, and how many?"]
- $2: 80 | 40 | Shortage of 40
- $3: 60 | 60 | [BLANK g3: "What's the gap at $3?"]
- $5: 20 | 100 | [BLANK g5: "Shortage or surplus, and how many?"]
```

### How does a B-tree index find a row? (default)
Steps: What does one page hold? · Which pointer does 33 follow? · What does the leaf return? · Why so few page reads?

```
form: structure · Index on users.id: finding id = 33
- query: Query [SELECT * FROM users; WHERE id = 33]
- root: Root page 1 [keys: 20 | 40; ptrs: p2 | p3 | p4]
- choice: [BLANK choice: "33 vs 20 and 40: which pointer?"]
- leaf2: Leaf page 2 [5 → (0,1); 12 → (0,2)]
- leaf3: Leaf page 3 [25 → (1,1); 33 → ?]
- leaf4: Leaf page 4 [41 → (2,1); 57 → (2,4)]
- heap: Heap page 1 (table) [slot 1: id 25, Ana; slot 2: id 29, Raj; slot 3: id 33, Mia]
- tid: [BLANK tid: "What (page, slot) does leaf entry 33 hold?"]
  root —p2→ leaf2
  root —p3→ leaf3
  root —p4→ leaf4
  leaf3 —row pointer→ heap
```

### How does a B-tree index find a row? (low)
Steps: What do root keys mean? · Which path does 42 take? · What does the leaf hold? · Why so few page reads?

```
form: structure · Finding id = 42 in a 3-level B-tree
- root: Root page [keys: 30 | 60; ptrs: P1 | P2 | P3]
- p1: P1 (internal) [keys: 10 | 20]
- p2: P2 (internal) [keys: 40 | 50; ptrs: L4 | L5 | L6]
- p3: P3 (internal) [keys: 70 | 80]
- l4: Leaf L4 [30, 35]
- l5: Leaf L5 [40 → ?; 42 → ?; 45 → ?]
- l6: Leaf L6 [50, 55]
- heap: Table page 7 [slot 3: id 42, name Ana]
- path: [BLANK path: "Which pages does 42 visit, in order?"]
- leafval: [BLANK leafval: "What does the leaf store beside 42?"]
  root —points to→ p1
  root —points to→ p2
  root —points to→ p3
  p2 —points to→ l4
  p2 —points to→ l5
  p2 —points to→ l6
  l5 —points to→ heap
```

### How does compound interest grow savings over 30 years? (default)
Steps: What makes year 2 different? · What is the balance after n years? · How often does money double? · Which matters more: rate or time?

```
form: timeline · $10,000 left alone at 7% a year
- e0 Year 0: $10,000 deposited
- e1 Year 1: $10,700
- e2 Year 2: [BLANK e2: "Balance at end of year 2?"]
- e10 Year 10: $19,672
- e20 Year 20: [BLANK e20: "Roughly what balance by year 20?"]
- e30 Year 30: $76,123
```

### How does compound interest grow savings over 30 years? (low)
Steps: Simple vs compound: what differs? · What formula gives year N? · How long until money doubles? · Why do late years dominate? · What do yearly deposits change?

```
form: timeline · $10,000 at 7% a year, no deposits
- y0 Year 0: $10,000
- y1 Year 1: $10,700
- y2 Year 2: [BLANK y2: "Balance after year 2?"]
- y10 Year 10: $19,672
- y20 Year 20: [BLANK y20: "Balance after 20 years?"]
- y30 Year 30: [BLANK y30: "Balance after 30 years?"]
```

### How does photosynthesis turn light into sugar? (default)
Steps: What happens when light hits chlorophyll? · Why does the plant split water? · How does light energy get carried? · How does CO2 become sugar?

```
form: sequence · One glucose: 6 CO2 + 6 H2O + light → C6H12O6 + 6 O2
lanes: Sun, Thylakoid, Stroma, Outside leaf
- s1: Sun → Thylakoid: photons hit chlorophyll
- s2: Outside leaf → Thylakoid: 6 H2O from roots
- s3: Thylakoid → Outside leaf: [BLANK s3: "Which gas leaves when water splits?"]
- s4: Thylakoid → Stroma: [BLANK s4: "Which two energy carriers move over?"]
- s5: Outside leaf → Stroma: 6 CO2 via stomata
- s6: Stroma → Thylakoid: ADP + NADP+ return to recharge
- s7: Stroma → Outside leaf: [BLANK s7: "What does the stroma finally build?"]
```

### How does photosynthesis turn light into sugar? (low)
Steps: What goes in, what comes out? · What does light actually do? · How is energy carried between stages? · How does CO₂ become sugar?

```
form: structure · One chloroplast making one glucose
- sun: Sunlight [photons hit chlorophyll]
- water: 6 H₂O [from the roots]
- thyl: Thylakoid (light reactions) [chlorophyll excited; water split]
- o2: [BLANK o2: "What gas leaves when water splits?"]
- carriers: [BLANK carriers: "Which two energy carriers are made?"]
- co2: [BLANK co2: "Which gas enters from the air?"]
- stroma: Stroma (Calvin cycle) [carbon fixed by RuBisCO]
- glucose: C₆H₁₂O₆ [1 glucose]
  sun —flows into→ thyl
  water —flows into→ thyl
  thyl —flows into→ o2
  thyl —flows into→ carriers
  carriers —flows into→ stroma
  co2 —flows into→ stroma
  stroma —flows into→ glucose
```

### How does the immune system fight a new virus? (default)
Steps: How does a cell notice infection? · What holds the virus off early? · How do T cells learn its shape? · How is the virus finally cleared? · Why is reinfection beaten faster?

```
form: sequence · One flu infection, day 0 to day 30
lanes: Flu virus, Nose cell, Neighbour cell, NK cell, Dendritic cell
- s1: Flu virus → Nose cell: Day 0: enters, makes ~1,000 copies
- s2: Nose cell → Neighbour cell: [BLANK s2: "What alarm does the infected cell send?"]
- s3: NK cell → Nose cell: [BLANK s3: "Days 1–3: what does the NK cell do?"]
- s4: Dendritic cell → T cell: Day 4: shows a flu fragment, lymph node
- s5: T cell → B cell: Day 5–6: helper signal
- s6: T cell → Nose cell: Day 7: killer T cell strikes
- s7: B cell → Flu virus: Day 7–10: antibodies bind virus
- s8: B cell → B cell: Day 30: some stay as memory
```

### How does the immune system fight a new virus? (low)
Steps: What happens in the first hours? · How does the body learn the virus? · How are infected cells destroyed? · How are free viruses stopped? · Why is reinfection usually milder?

```
form: timeline · One flu infection, Day 0 to Day 14
- e1 Day 0: Flu enters nose lining
- e2 Hours 6–24: [BLANK e2: "What do infected cells release to warn neighbours?"]
- e3 Day 1–2: Fever, aches begin
- e4 Day 3: Dendritic cell reaches lymph node
- e5 Day 5–7: [BLANK e5: "Which cells now kill infected cells?"]
- e6 Day 7–10: [BLANK e6: "What do B cells release into blood?"]
- e7 Day 10–14: Virus cleared, symptoms fade
- e8 Years later: Same flu returns
```

### How does the TLS handshake set up an encrypted connection? (default)
Steps: How do both get one secret? · Why trust it's really example.com? · How is tampering caught? · Why only one round trip?

```
form: sequence · TLS 1.3 handshake: browser → example.com
lanes: Browser, example.com
- s1: Browser → example.com: ClientHello: AES_128_GCM, x25519 key share A
- s2: example.com → Browser: [BLANK s2: "Server's reply that completes the key agreement"]
- s3: example.com → Browser: {Certificate: example.com, signed by CA}
- s4: example.com → Browser: [BLANK s4: "How server proves it holds the private key"]
- s5: example.com → Browser: {Finished}
- s6: Browser → example.com: {Finished}
- s7: Browser → example.com: {GET / HTTP/1.1}
```

### How does the TLS handshake set up an encrypted connection? (low)
Steps: What must the handshake achieve? · How do both get one key? · How is the server's identity proven? · How is tampering detected?

```
form: sequence · TLS 1.3: browser → example.com
lanes: Browser, example.com
- s1: Browser → example.com: ClientHello: random, x25519 key share, AES-128-GCM
- s2: example.com → Browser: [BLANK s2: "What must the server send back to agree a key?"]
- s3: example.com → Browser: 🔒 EncryptedExtensions
- s4: example.com → Browser: 🔒 Certificate: CN=example.com, signed by CA
- s5: example.com → Browser: [BLANK s5: "How does the server prove it owns that certificate?"]
- s6: example.com → Browser: 🔒 Finished (MAC of all messages so far)
- s7: Browser → example.com: [BLANK s7: "What does the browser send to end the handshake?"]
- s8: Browser → example.com: 🔒 GET / HTTP/1.1 (application data)
```

### LeetCode 200: Number of Islands (default)
Steps: Which land cells count as connected? · How to reach a whole island? · How to avoid counting twice? · When does the count go up? · How much time and memory?

```
form: grid · 3×4 grid: 1 = land, letter = island (lettered in reading order)
columns: c0 | c1 | c2 | c3
- r0: 1 · A | 1 · A | 0 | 0
- r1: 0 | [BLANK r1c1: "Land here: which island letter?"] | 0 | 1 · B
- r2: [BLANK r2c0: "Land here: which island letter?"] | 0 | [BLANK r2c2: "Touches r1c1 diagonally. Which letter?"] | 1 · B
```

### LeetCode 200: Number of Islands (low)
Steps: When are two cells connected? · How to find one island? · When does the count increase? · How to avoid recounting cells? · What does it cost?

```
form: grid · Grid: '1' = land, letter = its island
columns: col 0 | col 1 | col 2 | col 3
- row 0: 1 · A | 1 · A | 0 | 0
- row 1: [BLANK r1c0: "Land: which island, A or new?"] | 0 | 0 | 1 · B
- row 2: 0 | 0 | [BLANK r2c2: "Land: which island does it join?"] | 1 · B
```

### REST vs GraphQL vs gRPC: when to use which? (default)
Steps: What does each send? · How many round trips needed? · What can a CDN cache? · Who is calling the API? · So when use which?

```
form: grid · Fetch user 42 and their last 2 orders
columns: REST | GraphQL | gRPC
- The request: GET /users/42 | POST /graphql { user(id:42){ name orders(last:2){ total } }  | UserService.GetUser({id: 42})
- Round trips for user + orders: [BLANK c-trips-rest: "How many calls, and to which URLs?"] | 1 | 1 per RPC the server defines
- Payload on the wire: JSON text, full user resource | JSON, only the fields asked for | [BLANK c-fmt-grpc: "What format, and is it readable text?"]
- CDN caches it by URL?: Yes, GET /users/42 is cacheable | [BLANK c-cache-gql: "Can a CDN cache this? Why?"] | No, HTTP/2 POST to a method
```

### REST vs GraphQL vs gRPC: when to use which? (low)
Steps: What does each API revolve around? · Who decides the response shape? · What travels on the wire? · What breaks: caching, browsers, versioning? · Which fits which situation?

```
form: grid · Get user 42 + their 3 latest orders
columns: REST | GraphQL | gRPC
- Request sent: GET /users/42 ; GET /users/42/orders?limit=3 | [BLANK c-gql-req: "Write the single query for name + 3 orders"] | UserService.GetUserWithOrders({id: 42})
- Round trips: [BLANK c-rest-trips: "How many round trips does REST need here?"] | 1 (POST /graphql) | 1 call over HTTP/2
- Wire format: JSON text, all user fields | JSON, only fields requested | [BLANK c-grpc-fmt: "What format does gRPC send bytes in?"]
```

### What does git rebase do differently from merge? (default)
Steps: What is a commit's parent? · What does merge add to history? · What does rebase do to D, E? · Why might rebasing shared branches hurt? · When pick merge, when rebase?

```
form: structure · feature (D, E) branched at B; main moved to C
- b: B 1a2b [shared base]
- c: C 3c4d [main: fix typo]
- d: D 5e6f [feature: add login]
- e: E 7a8b [feature: add logout]
- m: [BLANK m: "After merge: what new commit is this?"]
- d2: [BLANK d2: "After rebase: which commit sits here?"]
- e2: E′ 2c9d [add logout (after rebase)]
  c —parent→ b
  d —parent→ b
  e —parent→ d
  m —parent→ c
  m —parent→ e
  d2 —parent→ c
  e2 —parent→ d2
```

### What does git rebase do differently from merge? (low)
Steps: What does merge create? · What does rebase do to commits? · Why do rebased hashes change? · When is rebasing dangerous?

```
form: structure · main: A-B-C, feature: D-E branched at B
- A: A [main; init]
- B: B [main; add login]
- C: C [main; fix typo]
- D: D [feature; add cart]
- E: E [feature; cart tests]
- M: M [after git merge feature]
- M-parents: [BLANK M-parents: "Which commits are M's parents?"]
- Dp: D' [after git rebase main; add cart]
- Dp-parent: [BLANK Dp-parent: "Which commit is D' built on?"]
- Dp-hash: [BLANK Dp-hash: "Same hash as D, or new?"]
  B —parent→ A
  C —parent→ B
  D —parent→ B
  E —parent→ D
  M —parent→ M-parents
  Dp —parent→ Dp-parent
```
