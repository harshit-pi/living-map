# What makes an interactive visual useful

**A visual teaches when the user has to produce something on it — a prediction, a missing node, a choice — and the change appears right next to its cause. Showing a complete, polished diagram is the weakest option.** Current as of 2026-10-16.

## 1. Explorable explanations

- **Patterns:** scrub a number and the model updates inline (Victor, *Explorable Explanations*, 2011); one system at several abstraction levels (Victor, *Ladder*, 2011); sandbox a model (Case, *Parable of the Polygons*); user-paced step-through (Distill, 3Blue1Brown).
- **Evidence is thin.** Hohman et al. (Distill, 2020) report a "moderate" retention boost across ~60 articles, no pooled effect. Brilliant's "6x more effective" is unsourced.
- **Hidden interaction goes unused.** NYT's Archie Tse (Malofiej 2016): readers scroll past steppers and tabs; ~85% never touch tooltips ⚠️ verify.

## 2. Retrieval and generation on diagrams

| Technique | Evidence |
|---|---|
| Predict, then reveal the gap | Kim, Reinecke & Hullman, CHI 2017: drawing a prediction first improved recall and comprehension |
| Build vs study a map | Schroeder et al. 2018 (142 effects, n=11,814): overall g=0.58; **constructing g=0.72, studying g=0.43** |
| Partial map | Chang, Sung & Chen 2001: beat building from scratch. Mixed since: in one chemistry study static maps won, mediated by fill-in accuracy |
| Retrieval vs mapping | Karpicke & Blunt, *Science* 2011: recall beat concept mapping a week later |
| Generation effect | Bertsch et al. 2007 (86 studies): d=0.40 |
| Worked-example fading | Helps near transfer; adding "which principle?" prompts gave medium-to-large far transfer (Atkinson, Renkl & Merrill 2003) |
| Struggle first | Sinha & Kapur 2021 (53 studies): positive, larger with high fidelity; d=0.36/0.58 ⚠️ verify |

## 3. Matching form to content

- **Larkin & Simon (1987):** a diagram wins only when layout puts related facts together, cutting search.
- **Tversky (2011):** lines mean sequence, containers category, arrows order or cause, up/right more. Arrows push readers to read function, not structure (Heiser & Tversky 2006).
- **Novick & Hurley (2001):** hierarchy for single paths, network for arbitrary links, matrix for two sets crossed ⚠️ verify.
- **Hegarty (2011):** show no more than the task needs.
- **Animation:** small gain over static (Höffler & Leutner 2007, d=0.37); learner-paced segments help (Rey et al. 2019).
- **Decisions:** argument mapping, ~0.8 SD in heavy-use courses (van Gelder) ⚠️ verify. Decoys bias choices in scatterplots; deleting dominated options strongly cut it (Dimara 2017, 2018).

## 4. AI canvases today

| Product | What the user does | Complaint / gap |
|---|---|---|
| tldraw make real / computer | sketch → live HTML; arrow-linked AI components; agents edit canvas | generated UI needs checking; heavy engineering |
| Excalidraw AI | text → Mermaid → shapes | few free runs; diagram is a one-shot |
| Heptabase | chat from a card, @-mention cards, drag replies onto board | single-user; AI reads, doesn't restructure |
| Napkin | text → visual "sparks" | generic on unstructured text; **invents pros/cons** |
| Miro AI | prompt → sketch diagram/mindmap; discard & retry | users ask to *edit existing* diagrams with AI |
| Claude visuals (Mar 2026) | inline SVG/HTML, revised as chat continues | ephemeral by design |
| ChatGPT dynamic visuals (Mar 2026) | sliders on 70+ math/science modules | fixed topic catalogue |
| Gemini dynamic view (Nov 2025) | bespoke UI per prompt | raters preferred it *when speed ignored*: latency |
| Flowith | branching nodes on canvas | "disorienting" first 15 min; desktop-first |

MindMap AI was not reviewed in depth.

## 5. Branches anchored to a canvas

- **Worked:** Sensecape's hierarchy view led users to explore more topics (UIST 2023). Graphologue asks follow-ups from a node (UIST 2023). CanvasConvo adds timeline, auto-summaries, goals (2026, n=24). Flowith's side-by-side answers expose contradictions.
- **Confused people:**
  - **Lost parentage:** ChatGPT Branch (Sep 2025) files branches as separate chats.
  - **Invisible context:** hidden memory and instructions ride along.
  - **Hidden branches:** claude.ai's edit-branches are hard to find.
  - **No merge:** interleaving branches breaks the thread; summarise back instead (tianpan.co, 2026).
  - **Throwaway:** Claude Code's `/btw` sees the chat but vanishes on dismiss.

## 12 design rules for the canvas

1. Before revealing a new diagram, ask the user to place or predict one thing on it, then show the gap (Kim 2017).
2. Ship skeletons, not finished maps: leave 2–4 nodes blank for the user to fill (Schroeder 2018; Chang 2001).
3. Fade over visits: full map first, more blanks each return; re-quizzing beats re-viewing (Atkinson/Renkl; Karpicke & Blunt 2011).
4. Check every fill-in and correct it at once, since learning tracks completion accuracy (chemistry fill-in study).
5. Pick the form from the relation: sequence → path, category → container, tree → hierarchy, two-set crossing → matrix, cause → arrow network (Tversky 2011; Novick & Hurley 2001).
6. Give arrows one meaning per diagram, and label it (Heiser & Tversky 2006).
7. Draw only what the current question needs, and zoom for detail along a ladder of abstraction (Hegarty 2011; Victor; Sensecape).
8. Every manipulable value looks manipulable, and its effect redraws beside it (Victor; Tse 2016).
9. Steps advance on user click and never autoplay (Rey 2019; Höffler & Leutner 2007).
10. For decisions, draw options × criteria plus pro/con argument nodes, and let the user strike dominated options (van Gelder; Dimara 2018).
11. Edit the diagram in place and never regenerate it; mark any node not grounded in the source as AI-inferred (Miro wishlist; Napkin).
12. Anchor each branch to a node, show a chip listing the context it carries, keep the parent link drawn, and return a summary rather than merge (ChatGPT Branch; CanvasConvo; tianpan.co).

## Sources

Victor worrydream.com/ExplorableExplanations, /LadderOfAbstraction · distill.pub/2020/communicating-with-interactive-articles · niemanlab.org/2016/03 (Malofiej) · idl.uw.edu/papers/explaining-the-gap · Schroeder et al., *Ed Psych Rev* 30(2) 2018 · Chang, Sung & Chen, *JCAL* 2001 · Karpicke & Blunt, *Science* 331 · Bertsch et al., *Mem Cogn* 35 · Sinha & Kapur, *RER* 2021 · Tversky, *TopiCS* 3 (2011) · Larkin & Simon, *Cog Sci* 11 · Hegarty, *TopiCS* 3 (2011) · Höffler & Leutner, *L&I* 17 · Rey et al., *Ed Psych Rev* 2019 · Dimara et al., aviz.fr/decoy, /deletion · Padilla et al., *CRPI* 3:29 · arxiv 2305.11483 (Sensecape), 2305.11473 (Graphologue), 2605.15848 (CanvasConvo) · claude.com/blog/claude-builds-visuals · openai.com/index/new-ways-to-learn-math-and-science-in-chatgpt · research.google/blog/generative-ui · tldraw.dev/docs/ai · wiki.heptabase.com/work-with-ai · community.miro.com/ideas/25943 · implicator.ai (Napkin) · listicler.com (Flowith) · tianpan.co/blog/2026-04-23-conversation-branching-first-class-primitive
