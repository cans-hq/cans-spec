---
title: API Design
tags: [api, backend]
---
- API
  - [[02-authentication#Sessions|Session rules]]
  - POST /users
    - Returns 201
  - ![[error-codes]]
  - [ ] Implement rate limiting
> [!note] Decision
> Use token bucket algorithm
