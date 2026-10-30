---
name: unslop
description: Cut AI tells from any writing. Must always apply.
disable-model-invocation: true
---

# Unslop

Scan for these patterns and rewrite while preserving meaning and intended tone. Rule numbers are stable IDs cited by other skills; leave a gap when removing one.

## Content

3. **Superficial -ing phrases.** Delete phrases such as "highlighting" or "showcasing," or support them with sources.
5. **Vague attributions.** Name the source instead of "experts believe," or delete the claim.

## Language

7. **AI vocabulary.** Replace words such as "delve," "foster," "pivotal," "tapestry," and "underscore" with plain words.
8. **Fancy ways to say "is."** Replace "serves as," "stands as," or "boasts" with "is" or "has."
9. **"Not just X, but Y."** State the point directly.
10. **Rule of three.** Do not force ideas into threes.
11. **Synonym cycling.** Pick one term for a concept and repeat it.
12. **False ranges.** List topics directly unless "from X to Y" describes a meaningful scale.

## Style

13. **Em dash overuse.** Use periods or commas, not em dashes, parentheses, en dashes, or hyphens as substitutes. Split separated thoughts into sentences.
14. **Colon overuse.** Use colons before lists or examples, not as mid-sentence connectors.
15. **Boldface overuse.** Do not bold every proper noun or acronym.
16. **Inline-header lists.** Cut labels that restate their sentence. A label followed by new detail is fine.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
19. **Curly quotes.** Use straight quotes.

## Communication artifacts

20. **Chatbot phrases.** Remove "I hope this helps," "Certainly," "Let me know if," and similar phrases.
22. **Sycophantic tone.** Respond directly without flattery.

## Filler

23. **Filler phrases.** Replace "in order to" with "to" and "due to the fact that" with "because." Delete "it is important to note."
24. **Excessive hedging.** Replace stacked uncertainty with one qualifier, such as "may."
25. **Generic conclusions.** State specific plans or facts, or cut the conclusion.

## Jargon

26. **Abstract metaphor nouns.** Replace terms such as "substrate," "wedge," "vector," "nexus," "primitive," "harness," "surface," "bedrock," "scaffolding," "modality," "paradigm," "gold-plating," "ratchet," "evacuate," "endgame," "north star," and "flywheel" with concrete words or the mechanism's name.

## Plain speech

27. **Say what it does, not how it feels.** Name a mechanism, instruction, fact, or number. Replace "types that follow your schema" with "a column rename fails the build." Cut sentences you cannot make concrete or that could appear unchanged in another project's docs.
28. **Shorten or split dense sentences.** Keep one idea per sentence so the reader need not backtrack.
29. **Active voice.** Name the actor. Passive is fine when the actor is unknown or irrelevant.
30. **Cut adverbs, or use a stronger verb.** Replace "runs quickly" with a measurement or "is fast."
31. **Prefer the plain word.** Use "use" for "utilize" or "leverage," "help" for "facilitate," and "if" for "in the event that."
32. **Mannered prose.** Replace metaphors, rhetorical fragments, personified code, and stock framing with literal statements. Rule 26 covers metaphor nouns.
33. **Over-compression.** Use complete sentences with articles and verbs. Spell out arrows and abbreviations rather than making the reader decode fragments.
