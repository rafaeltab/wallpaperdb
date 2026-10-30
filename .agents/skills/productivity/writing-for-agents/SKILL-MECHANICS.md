# Skill mechanics

For general agent-document writing, use [writing-for-agents](SKILL.md).

## Invocation

- Model-invoked skills omit `disable-model-invocation`. Their always-loaded `description` must identify trigger branches. Agents and other skills can discover them, and users can invoke them by name. Use this for autonomous discovery or shared reference reached by other skills.
- User-invoked skills set `disable-model-invocation: true`. Their description is a short human-facing summary without trigger lists. Only the user can invoke them; the human must remember they exist.

Choose model invocation only when autonomous discovery or another skill needs it. Put reference shared by user-invoked skills in a plain file they can both link to.

## Splitting by invocation

Split a model-invoked skill when a distinct term should trigger it independently or another skill needs to reach it. That discovery must justify an additional always-loaded description. For splitting by sequence, see [SKILL.md](SKILL.md#when-to-split).

## Router skills

A user-invoked router lists other skills and when to use them, giving the human one entry point to remember. It can suggest user-invoked skills but cannot invoke them.
