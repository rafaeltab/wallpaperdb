---
name: to-questionnaire
description: Turn a decision you can't fully answer into a questionnaire for someone else to fill in.
disable-model-invocation: true
---

Create a Markdown questionnaire for a person who holds knowledge the user needs. It may be answered asynchronously or together in a meeting. Interview the user about the recipient and desired answers, not the subject they need help understanding.

1. Ask, in one exchange, for the recipient's role, expertise, and relationship to the user. Continue when you know who they are and what they know that the user does not.
2. Ask, in one exchange, which decisions or facts the user needs from them. Continue when you have a concrete list of what the user must be able to do or decide afterward.
3. Write `to-questionnaire-<slug>.md` in the current directory and report its path. Cover every item from step 2.

## Document structure

Frame it as a discovery questionnaire. Put the most important questions first and group by theme when there are more than a handful.

<questionnaire-template>

# <Questionnaire title>

**Purpose:** <the decision this questionnaire supports>

**From:** <user>, **To:** <recipient>, **How your answers will be used:** <destination>

## Context

One paragraph giving the recipient enough context to answer.

## How to answer

State the deadline and estimated effort. Welcome partial answers and "I don't know"; ask respondents to flag uncertainty.

## <Theme heading>

Use one section per theme. Each question addresses one idea and has an answer stub beneath it. Add a one-line reason only if the question could be misunderstood or invite a throwaway answer.

### <Question>

>

## Anything else?

What else should we know?

</questionnaire-template>
