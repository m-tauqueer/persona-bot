# frontend

The voice bot UI. Tokens come from the component library; the gallery itself is not in this repo. See [`COMPONENT_LIBRARY.md`](COMPONENT_LIBRARY.md).

```bash
npm run dev:frontend
```

- http://localhost:5188/ — landing and sign-in
- http://localhost:5188/dashboard — personal app (home, chat, voice)
- http://localhost:5188/admin — owner app (Overview, Conversations, People, Persona)

Auth and API calls go to this origin. Vite proxies `/auth`, `/api`, and `/ws` to `GATEWAY_PORT` (4100). Do not point the browser at 4000 — that is Engram.

Stylesheet import order in `src/main.tsx` is load-bearing. Do not reorder it. Do not `import` CSS from components.
