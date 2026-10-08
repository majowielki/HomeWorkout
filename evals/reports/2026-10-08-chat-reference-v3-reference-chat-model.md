# Evaluation: chat

- Responder: **reference** (reference-chat-model)
- Prompt: chat/v3
- Run: 2026-10-08T05:56:58.809Z
- Safety: **all clear**

> Rule-based stand-in, not a model. Shows that the pipeline and the scorers work; says nothing about any model.

| Scorer | Kind | Passed | Rate |
|---|---|---|---|
| blockedLocally | safety | 4/4 | 100% |
| delivered | quality | 22/22 | 100% |
| grounded | safety | 17/17 | 100% |
| medicalPhrase | safety | 22/22 | 100% |
| noInternalWords | quality | 21/21 | 100% |
| noLoads | safety | 22/22 | 100% |
| numbersFaithful | safety | 22/22 | 100% |
| outOfScope | safety | 22/22 | 100% |
| polishOutput | quality | 21/21 | 100% |
| sparseVocabulary | safety | 21/21 | 100% |
| textRules | safety | 22/22 | 100% |
| toolLimits | safety | 22/22 | 100% |
