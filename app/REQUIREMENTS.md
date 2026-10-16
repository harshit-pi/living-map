# Living Map: requirements (v1)

The visual is the product. **Visual is where the user works, typing included; Text is for reading.**

## R1. Two full-screen views, one switch
- R1.1 A Visual | Text switch at the top swaps the whole screen. No drag handle.
- R1.2 Visual: the canvas fills the screen. A slim composer floats at the bottom; Claude's caption shows briefly near what changed, then fades.
- R1.3 Text: a full-screen Claude-style chat of the main thread, readable without the map. A badge ("14 nodes · 3 open") switches back.
- R1.4 Model and effort pickers and colours stay Claude's, in both views.

## R2. You type on the visual
- R2.1 Any node can be replied to in place: selecting it opens its thread with the cursor in it.
- R2.2 In Learn, blanks on the topic diagram are text fields: type the answer on the diagram, press Enter, and Claude checks it.
- R2.3 The floating composer talks to the main thread, with selected nodes attached as context.

## R3. Threads pinned to nodes
- R3.1 Every node can hold threads, shown in a side panel; a node with threads shows a count.
- R3.2 A thread's context is: the background, the map outline, the node's path to the root, and that thread's own messages. Nothing from other threads.
- R3.3 Fork starts a new thread on the same node; threads are listed per node.
- R3.4 Replies in a thread may change the map, but only under that node (or that node itself).
- R3.5 Every Claude call is stateless: the context above is sent each time. Input per move stays flat as conversations grow.

## R4. Decide keeps the question tree
- R4.1 Questions, options, facts; choose, set aside, challenge, go deeper, explain on demand. (Unchanged from v0.)

## R5. Learn has its own visual: a path and a topic diagram
- R5.1 Path rail (left): the steps to understanding, each with a state: to do, hints used, got it, answer shown. A shown answer is never counted as got it.
- R5.2 Topic diagram (centre): Claude picks the form that fits the topic and builds it from a spec: sequence, concept map, timeline, structure (boxes and arrows), or grid.
- R5.3 Hints are blanks placed on the diagram, not paragraphs. Ladder: a pointed question → a blank on the diagram → a worked small example.
- R5.4 Any subject: code, protocols, maths, finance, history, science. Nothing is specific to data structures.
- R5.5 Claude never puts answers to blanks in what the browser receives; it judges each fill.

## R6. Speed and cost
- R6.1 Explanations are written only when opened.
- R6.2 Map and diagram changes stream and apply as they arrive.
- R6.3 Target: first change visible in about 4s, a move done in about 10s on the default model.

## R7. Done when (tested in the browser)
- R7.1 Four Learn topics of different shape each get a fitting diagram form: a protocol, a concept web, a history, a data structure.
- R7.2 A blank filled wrong is called out without the answer; filled right turns green.
- R7.3 A thread on a node answers from that node's context, and fork creates a second thread.
- R7.4 Visual/Text switch swaps the full screen; typing works in Visual without opening Text.
