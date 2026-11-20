<?php
declare(strict_types=1);

require_once __DIR__ . '/common.php';

try {
    payment_require_method('GET');
    $token = payment_input_string($_GET, 'txid');
    $key = payment_api_key();
    $gatewayId = payment_read_txid($token, $key);
    $response = paradise_get_transaction($gatewayId);

    $status = payment_paradise_status($response);
    if ($status === '') {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou um status inválido.');
    }
    $amount = payment_integer($response['amount'] ?? null);
    payment_json_response([
        'txid' => $token,
        'status' => $status,
        'paid' => payment_paradise_is_paid($status),
        'amount' => $amount === false ? null : $amount,
    ] + payment_pix_fields($response));
} catch (PaymentApiException $error) {
    payment_error_response($error);
} catch (Throwable $error) {
    error_log('[Payment] Erro interno em payment-status.php (' . get_class($error) . ').');
    payment_json_response(['code' => 'internal_error', 'error' => 'Não foi possível consultar o pagamento.'], 500);
}
