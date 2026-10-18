| Move                   | baseline: out tokens · reply chars · first word · total (n) | spare: out tokens · reply chars · first word · total (n) | after: out tokens · reply chars · first word · total (n) |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| learn start            | 3148 · 4948 · 15.8s · 31.7s (4)                             | 3199 · 4914 · 15.7s · 31.6s (4)                          | 2565 · 3713 · 13.0s · 25.2s (4)                          |
| learn open step        | 3186 · 4659 · 20.7s · 35.7s (1)                             | 3782 · 4644 · 19.9s · 35.6s (1)                          | 2236 · 2691 · 20.5s · 29.2s (1)                          |
| explore start (choice) | 773 · 1802 · 2.1s · 7.9s (2)                                | 819 · 1879 · 3.7s · 10.1s (2)                            | 774 · 1848 · 1.8s · 7.6s (2)                             |
| explore fill           | 2498 · 4943 · 6.3s · 23.5s (1)                              | 1954 · 3902 · 4.6s · 18.0s (1)                           | 2425 · 3878 · 8.3s · 22.2s (1)                           |
| explore start (why)    | 782 · 1968 · 2.9s · 9.7s (1)                                | 859 · 2160 · 1.6s · 9.1s (2)                             | 774 · 2003 · 4.1s · 12.5s (2)                            |
| explore deeper         | 569 · 1400 · 5.0s · 10.0s (1)                               | 734 · 1674 · 1.8s · 7.6s (1)                             | 714 · 1515 · 2.3s · 7.3s (1)                             |

| Signal                                            | baseline        | spare           | after           |
| ------------------------------------------------- | --------------- | --------------- | --------------- |
| Learn: model held on the first try                | 5/5             | 5/5             | 5/5             |
| Learn: model ready in the end                     | 5/5             | 5/5             | 5/5             |
| Learn: predict kept after the giveaway scrub      | 5/5             | 5/5             | 5/5             |
| Learn: every key link kept its hint               | 5/5             | 5/5             | 5/5             |
| Learn: what-if present                            | 5/5             | 5/5             | 5/5             |
| Learn: parts / links / key links (mean)           | 7.0 / 6.2 / 2.6 | 7.0 / 6.4 / 2.6 | 7.0 / 6.6 / 2.2 |
| Explore start: frame as expected (choose, causes) | 4/4             | 4/4             | 4/4             |
| Explore start: options / wants (mean)             | 4.3 / 6.0       | 4.3 / 6.0       | 4.3 / 6.0       |
| Explore start: stand written                      | 4/4             | 4/4             | 4/4             |
| Explore fill: cells filled of options × wants     | 24/24           | 18/18           | 24/24           |
| Explore deeper: nodes added                       | 4               | 5               | 4               |
| Ops that could not be read                        | 0               | 0               | 0               |
| Calls on a process started ahead                  | (no spare)      | 9/11            | 9/11            |
| Eval cost                                         | $0.69           | $0.71           | $0.51           |
