# issue-flow-ai

OAuth 기반(클라이언트 크리덴셜)으로 LLM 호출하는 최소 런타임.

## 핵심
- API Key 없이 OAuth2 토큰 발급 후 Bearer로 LLM 호출
- `/v1/ask`로 텍스트 입력받아 LLM 응답 반환
- OpenAI-compatible `/chat/completions` 엔드포인트 기준

## 실행
```bash
cp .env.example .env
# Fill values in .env
npm install
npm run test
npm run dev
```

## API
- `GET /health`
- `POST /v1/ask`
  - body: `{ "text": "요약해줘" }`
  - response: `{ "answer": "..." }`

## 주의
- 토큰은 메모리 캐시(만료 10초 전 재발급)
- OAuth 공급자 스펙이 다르면 `src/oauth-token-provider.ts`의 body 파라미터를 조정
