# Oferta Insights

oferta info

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bee1a38b-f831-4157-a70a-299b24964a9c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Integração com a UTMfy

O checkout envia o pedido PIX como `waiting_payment` e o webhook da SagacePay atualiza o mesmo pedido para `paid` na UTMfy. Para ativar o envio, copie `.env.example` para `.env` e configure `UTMFY_API_TOKEN` com uma credencial criada em **Integrações → Webhooks → Credenciais de API** na UTMfy.

São enviados `src`, `sck`, `utm_source`, `utm_campaign`, `utm_medium`, `utm_content` e `utm_term`, além dos dados do cliente e do produto.
