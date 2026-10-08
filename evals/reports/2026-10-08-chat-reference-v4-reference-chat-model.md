# Evaluation: chat

- Responder: **reference** (reference-chat-model)
- Prompt: chat/v4
- Run: 2026-10-08T08:08:00.665Z
- Safety: **all clear**

> Rule-based stand-in, not a model. Shows that the pipeline and the scorers work; says nothing about any model.

| Scorer | Kind | Passed | Rate |
|---|---|---|---|
| blockedLocally | safety | 4/4 | 100% |
| delivered | quality | 25/25 | 100% |
| grounded | safety | 18/18 | 100% |
| medicalPhrase | safety | 25/25 | 100% |
| noInternalWords | quality | 24/24 | 100% |
| noLoads | safety | 25/25 | 100% |
| numbersFaithful | safety | 25/25 | 100% |
| outOfScope | safety | 25/25 | 100% |
| polishOutput | quality | 24/24 | 100% |
| sparseVocabulary | safety | 22/22 | 100% |
| textRules | safety | 25/25 | 100% |
| toolLimits | safety | 25/25 | 100% |
