<?php
declare(strict_types=1);

if (is_file(__DIR__ . '/config.local.php')) {
    require_once __DIR__ . '/config.local.php';
}

const PARADISE_API_BASE = 'https://multi.paradisepags.com/api/v1';

final class PaymentApiException extends RuntimeException
{
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $errorCode,
        string $message
    ) {
        parent::__construct($message);
    }
}

function payment_json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function payment_require_method(string $method): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        throw new PaymentApiException(405, 'method_not_allowed', 'Método não permitido.');
    }
}

function payment_read_json(): array
{
    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > 65536) {
        throw new PaymentApiException(413, 'request_too_large', 'A solicitação excede o limite permitido.');
    }

    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        throw new PaymentApiException(400, 'invalid_json', 'Envie os dados do pedido em JSON.');
    }

    try {
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new PaymentApiException(400, 'invalid_json', 'Os dados enviados não são um JSON válido.');
    }

    if (!is_array($data)) {
        throw new PaymentApiException(400, 'invalid_json', 'Os dados enviados não são válidos.');
    }

    return $data;
}

function payment_api_key(): string
{
    $configuredKey = payment_config('PARADISE_API_KEY');
    $key = is_string($configuredKey) ? trim($configuredKey) : '';
    if ($key === '' || $key === 'COLE_SUA_CHAVE_AQUI') {
        throw new PaymentApiException(503, 'payment_not_configured', 'Configure a API Key da Paradise no servidor.');
    }

    return $key;
}

function payment_config(string $name): string
{
    $value = getenv($name);
    if ($value === false && defined($name)) {
        $value = constant($name);
    }

    return is_string($value) ? trim($value) : '';
}

function payment_postback_url(): ?string
{
    $url = payment_config('PARADISE_POSTBACK_URL');
    if ($url === '') {
        return null;
    }

    $parts = parse_url($url);
    if (!is_array($parts)
        || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
        || empty($parts['host'])
        || str_contains(strtolower($url), 'cole_seu_dominio')
        || isset($parts['user'])
        || isset($parts['pass'])
        || isset($parts['fragment'])) {
        throw new PaymentApiException(503, 'postback_not_configured', 'Configure a URL HTTPS pública para o webhook Paradise no servidor.');
    }

    $secret = payment_config('PARADISE_WEBHOOK_SECRET');
    if ($secret !== '') {
        $url .= (str_contains($url, '?') ? '&' : '?') . 'token=' . rawurlencode($secret);
    }

    return $url;
}

function payment_input_string(array $source, string $key): string
{
    $value = $source[$key] ?? '';
    if (!is_string($value) && !is_int($value)) {
        throw new PaymentApiException(400, 'invalid_request', 'Os dados enviados não são válidos.');
    }

    return trim((string) $value);
}

function payment_integer(mixed $value): int|false
{
    if (is_int($value)) {
        return $value;
    }
    if (!is_string($value) || !preg_match('/^-?\d+$/', $value)) {
        return false;
    }

    $integer = filter_var($value, FILTER_VALIDATE_INT);
    return $integer === false ? false : $integer;
}

function payment_gateway_string(array $response, string $key, string $default = ''): string
{
    if (!isset($response[$key])) {
        return $default;
    }
    if (!is_string($response[$key]) && !is_int($response[$key])) {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou uma resposta inválida.');
    }

    return trim((string) $response[$key]);
}

function payment_paradise_status(array $response): string
{
    $row = is_array($response['data'] ?? null) && array_is_list($response['data'])
        ? ($response['data'][0] ?? [])
        : [];
    $values = [
        $response['payment_status'] ?? null,
        $response['transaction_status'] ?? null,
        $response['status'] ?? null,
        is_array($response['data'] ?? null) ? ($response['data']['status'] ?? null) : null,
        $row['status'] ?? null,
    ];

    foreach ($values as $value) {
        if (is_string($value) || is_int($value)) {
            $status = strtolower(trim((string) $value));
            if ($status !== '' && $status !== 'success') {
                return preg_replace('/[\s_-]+/', '_', $status) ?? $status;
            }
        }
    }

    return '';
}

function payment_paradise_is_paid(string $status): bool
{
    return in_array($status, ['approved', 'paid', 'completed', 'complete', 'confirmed', 'payment_approved'], true);
}

function payment_pix_fields(array $response): array
{
    $pixCode = payment_gateway_string($response, 'qr_code');
    if ($pixCode === '') {
        $pixCode = payment_gateway_string($response, 'pix_code');
    }
    if (strlen($pixCode) > 10000) {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou um código Pix inválido.');
    }

    $qrBase64 = payment_gateway_string($response, 'qr_code_base64');
    if (strlen($qrBase64) > 2000000
        || !preg_match('#^data:image/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$#', $qrBase64)) {
        $qrBase64 = '';
    }

    $expiresAt = payment_gateway_string($response, 'expires_at');
    if ($expiresAt !== '') {
        try {
            $expiresAt = (new DateTimeImmutable($expiresAt, new DateTimeZone('America/Sao_Paulo')))->format(DATE_ATOM);
        } catch (Exception) {
            $expiresAt = '';
        }
    }

    return ['pix_code' => $pixCode, 'qr_code_base64' => $qrBase64, 'expires_at' => $expiresAt];
}

function paradise_create_pix(array $payload): array
{
    $response = paradise_request('POST', '/transaction', $payload);
    if (strtolower(payment_gateway_string($response, 'status')) !== 'success') {
        throw new PaymentApiException(502, 'gateway_error', 'A Paradise não confirmou a criação do Pix.');
    }

    $remoteId = payment_gateway_string($response, 'transaction_id');
    $fields = payment_pix_fields($response);
    if ($fields['pix_code'] === '') {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway não retornou o código Pix.');
    }
    if (isset($response['amount']) && payment_integer($response['amount']) !== $payload['amount']) {
        error_log('[Paradise] Valor retornado diverge do valor enviado.');
        throw new PaymentApiException(502, 'gateway_amount_mismatch', 'O valor retornado pelo gateway não corresponde ao pedido.');
    }

    return [
        'txid' => payment_create_txid($remoteId, payment_api_key()),
        'status' => 'pending',
        'paid' => false,
        'amount' => $payload['amount'],
    ] + $fields;
}

function paradise_get_transaction(string $gatewayId): array
{
    return paradise_request('GET', '/query?action=get_transaction&id=' . rawurlencode($gatewayId));
}

function paradise_request(string $method, string $path, ?array $payload = null): array
{
    if (!function_exists('curl_init')) {
        throw new PaymentApiException(503, 'server_not_ready', 'O servidor de pagamentos precisa da extensão cURL.');
    }

    $headers = [
        'Accept: application/json',
        'X-API-Key: ' . payment_api_key(),
    ];
    $options = [
        CURLOPT_URL => PARADISE_API_BASE . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ];

    if ($payload !== null) {
        try {
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new PaymentApiException(500, 'request_encoding_failed', 'Não foi possível preparar o pagamento.');
        }
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_HTTPHEADER] = $headers;
        $options[CURLOPT_POSTFIELDS] = $body;
    }

    $curl = curl_init();
    if ($curl === false || !curl_setopt_array($curl, $options)) {
        if ($curl !== false) {
            unset($curl);
        }
        throw new PaymentApiException(503, 'server_not_ready', 'Não foi possível preparar a conexão com o gateway.');
    }

    $rawResponse = curl_exec($curl);
    $httpStatus = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    unset($curl);

    if (!is_string($rawResponse)) {
        error_log('[Paradise] Falha de comunicação (HTTP ' . $httpStatus . '): ' . substr($curlError, 0, 300));
        throw new PaymentApiException(502, 'gateway_unavailable', 'Não foi possível comunicar com o gateway Paradise. Tente novamente.');
    }

    try {
        $data = json_decode($rawResponse, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        error_log('[Paradise] Resposta não JSON (HTTP ' . $httpStatus . ').');
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou uma resposta inválida.');
    }

    if (!is_array($data)) {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou uma resposta inválida.');
    }

    if ($httpStatus < 200 || $httpStatus >= 300) {
        $code = match ($httpStatus) {
            400 => 'gateway_invalid_request',
            401, 403 => 'gateway_authentication_failed',
            404 => $method === 'GET' ? 'order_not_found' : 'gateway_endpoint_not_found',
            422 => 'gateway_invalid_request',
            default => 'gateway_error',
        };
        $message = match ($httpStatus) {
            400, 422 => 'O gateway rejeitou os dados do pagamento. Confira os dados e tente novamente.',
            401, 403 => 'O gateway rejeitou a API Key. Confira a chave configurada no servidor.',
            404 => 'O endpoint ou transação não foi encontrado no gateway.',
            default => 'O gateway não conseguiu processar a solicitação.',
        };
        error_log('[Paradise] HTTP ' . $httpStatus . ' em ' . strtok($path, '?') . ' (' . $code . ').');
        throw new PaymentApiException($code === 'order_not_found' ? 404 : 502, $code, $message);
    }

    return $data;
}

function payment_create_txid(string $gatewayId, string $key): string
{
    if ($gatewayId === '' || strlen($gatewayId) > 160 || !preg_match('/^[A-Za-z0-9_-]+$/', $gatewayId)) {
        throw new PaymentApiException(502, 'invalid_gateway_response', 'O gateway retornou um identificador inválido.');
    }

    $encodedId = rtrim(strtr(base64_encode($gatewayId), '+/', '-_'), '=');
    return $encodedId . '.' . hash_hmac('sha256', $gatewayId, $key);
}

function payment_read_txid(string $token, string $key): string
{
    if (!preg_match('/^([A-Za-z0-9_-]{2,214})\.([a-f0-9]{64})$/D', $token, $parts)) {
        throw new PaymentApiException(404, 'order_not_found', 'Pedido não encontrado.');
    }

    $encodedId = $parts[1] . str_repeat('=', (4 - strlen($parts[1]) % 4) % 4);
    $gatewayId = base64_decode(strtr($encodedId, '-_', '+/'), true);
    if (!is_string($gatewayId)
        || !preg_match('/^[A-Za-z0-9_-]{1,160}$/', $gatewayId)
        || !hash_equals(hash_hmac('sha256', $gatewayId, $key), $parts[2])) {
        throw new PaymentApiException(404, 'order_not_found', 'Pedido não encontrado.');
    }

    return $gatewayId;
}

function payment_error_response(PaymentApiException $error): never
{
    payment_json_response([
        'code' => $error->errorCode,
        'error' => $error->getMessage(),
    ], $error->httpStatus);
}
