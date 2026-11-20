# Integração Paradise PIX

A página `oferta/pagamento.html` cria o Pix em `POST /tkk-pedido/api/create-pix.php` e consulta o status em `GET /tkk-pedido/api/payment-status.php?txid=...`.

Configure `PARADISE_API_KEY` no ambiente do PHP ou em `config.local.php` a partir de `config.local.php.example`. O Apache com `.htaccess` habilitado bloqueia acesso direto ao arquivo local. Mantenha a chave no servidor.

Use PHP 8.1 ou superior com a extensão cURL. O backend chama `POST /api/v1/transaction` e `GET /api/v1/query?action=get_transaction&id={transaction_id}` em `https://multi.paradisepags.com`. O Pix avulso usa `source: api_externa`, que dispensa `productHash`. O backend valida o valor em centavos com o catálogo e aplica o limite de R$ 600,00 deste checkout.

A tela guarda o Pix Copia e Cola recebido na criação e desenha o QR no navegador quando a Paradise não fornece uma imagem. A consulta pode retornar apenas o status. Ao receber a confirmação da transação, a própria tela mostra o pagamento confirmado.

O webhook é opcional para criar ou consultar o Pix. Se já houver um receptor implantado, configure `PARADISE_POSTBACK_URL` com a URL HTTPS e `PARADISE_WEBHOOK_SECRET` com o token que o receptor valida. Este projeto inclui a consulta de status com a página aberta. Registro durável de pedidos, webhook receptor e acompanhamento de entregas dependem de um backend de pedidos.
