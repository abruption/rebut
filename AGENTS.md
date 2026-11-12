# Rebut development

- Production profile: `gpt-6-astra` / medium. Use `gpt-6-luna` for any real API tests; automated tests must mock the provider. Do not infer Astra availability or review quality from Luna smoke tests.
- Validate with `npm run typecheck`, `npm run build`, then `npm test`. Worker integration tests consume the built bundle.
- Retain principal-scoped request IDs, atomic budget reservations, and deduplication across upgrades. Unknown execution is never permission to create another paid call or release its reservation automatically.
- Keep source, reviews, credentials and private deployment identifiers out of public code and logs. Store only bounded metadata in D1; preserve private Wrangler config outside Git.
- Keep the OpenAI reviewer opt-in. Do not automatically replace an existing Claude/Gemini policy or fan out to three reviewers.
