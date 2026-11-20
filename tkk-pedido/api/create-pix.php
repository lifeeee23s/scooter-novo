<?php
declare(strict_types=1);

require_once __DIR__ . '/common.php';

// A API Key é carregada por common.php e compartilhada com payment-status.php.
// Configure-a em config.local.php (modelo em config.local.php.example) ou no ambiente do PHP.

try {
    payment_require_method('POST');
    $payload = payment_read_json();

    $name = payment_input_string($payload, 'name');
    $email = payment_input_string($payload, 'email');
    $phone = preg_replace('/\D+/', '', payment_input_string($payload, 'cellphone'));
    if (preg_match('/^55\d{10,11}$/D', $phone)) {
        $phone = substr($phone, 2);
    }
    $document = preg_replace('/\D+/', '', payment_input_string($payload, 'taxId'));
    $address = $payload['address'] ?? null;
    $items = $payload['items'] ?? null;

    if (strlen($name) < 2 || strlen($name) > 150
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false
        || !in_array(strlen($phone), [10, 11], true)
        || !in_array(strlen($document), [11, 14], true)
        || !is_array($address)
        || !is_array($items)
        || count($items) < 1 || count($items) > 4) {
        throw new PaymentApiException(400, 'invalid_customer_or_items', 'Confira seus dados pessoais e os itens do pedido.');
    }

    $street = payment_input_string($address, 'street');
    $number = payment_input_string($address, 'number');
    $neighborhood = payment_input_string($address, 'neighborhood');
    $city = payment_input_string($address, 'city');
    $state = strtoupper(payment_input_string($address, 'state'));
    $zipcode = preg_replace('/\D+/', '', payment_input_string($address, 'cep'));
    $complement = payment_input_string($address, 'complement');
    if ($street === '' || strlen($street) > 200
        || $number === '' || strlen($number) > 40
        || $neighborhood === '' || strlen($neighborhood) > 100
        || $city === '' || strlen($city) > 100
        || strlen($complement) > 200
        || !preg_match('/^[A-Z]{2}$/', $state)
        || strlen($zipcode) !== 8) {
        throw new PaymentApiException(400, 'invalid_address', 'Confira os dados do endereço de entrega.');
    }

    // Preços em centavos, alinhados ao catálogo e aos adicionais do checkout.
    $catalog = [
        109 => ['name' => 'Bicicleta Elétrica GTS Super Power 500W', 'unit_cents' => 12984],
        991091 => ['name' => 'Scooter Patinete Elétrico 36V Bluetooth 3 Velocidades 100kg', 'unit_cents' => 12990],
        991092 => ['name' => 'Mini Compressor de Ar Portátil Digital Recarregável 150 PSI — BOM-8905 Bomvink', 'unit_cents' => 4990],
        991093 => ['name' => 'Garantia estendida por mais 12 meses', 'unit_cents' => 3990],
    ];

    $mainQuantity = null;
    $bumpIds = [];
    foreach ($items as $item) {
        if (!is_array($item) || !isset($item['id'], $item['qty'])) {
            throw new PaymentApiException(400, 'invalid_items', 'Os itens do pedido são inválidos.');
        }
        $id = payment_integer($item['id']);
        $quantity = payment_integer($item['qty']);
        if ($id === false || $quantity === false || !isset($catalog[$id])) {
            throw new PaymentApiException(400, 'invalid_items', 'Os itens do pedido são inválidos.');
        }
        if ($id === 109) {
            if ($mainQuantity !== null || $quantity < 1 || $quantity > 1000) {
                throw new PaymentApiException(400, 'invalid_items', 'A quantidade do produto é inválida.');
            }
            $mainQuantity = $quantity;
            continue;
        }
        if ($quantity !== 1 || isset($bumpIds[$id])) {
            throw new PaymentApiException(400, 'invalid_items', 'Os adicionais do pedido são inválidos.');
        }
        $bumpIds[$id] = true;
    }
    if ($mainQuantity === null) {
        throw new PaymentApiException(400, 'invalid_items', 'O produto principal não está no pedido.');
    }

    $productSubtotal = $catalog[109]['unit_cents'] * $mainQuantity;
    $couponApplied = $payload['coupon_applied'] ?? false;
    if (!is_bool($couponApplied)) {
        throw new PaymentApiException(400, 'invalid_coupon', 'O desconto informado é inválido.');
    }
    $couponDiscount = $couponApplied && $productSubtotal >= 3900
        ? min(3000, intdiv($productSubtotal + 5, 10))
        : 0;
    $expectedAmount = $productSubtotal - $couponDiscount;
    foreach (array_keys($bumpIds) as $id) {
        $expectedAmount += $catalog[$id]['unit_cents'];
    }
    if ($expectedAmount > 60000) {
        throw new PaymentApiException(422, 'amount_exceeds_gateway_limit', 'Este pedido excede o limite de R$ 600,00 para pagamento via Paradise.');
    }

    $requestedAmount = payment_integer($payload['amount'] ?? null);
    if ($requestedAmount === false || $requestedAmount !== $expectedAmount) {
        payment_json_response([
            'code' => 'amount_mismatch',
            'error' => 'O valor do pedido mudou. Volte ao checkout e tente novamente.',
        ], 409);
    }

    $descriptionParts = [$catalog[109]['name'] . ' (' . $mainQuantity . ' un.)'];
    foreach (array_keys($bumpIds) as $id) {
        $descriptionParts[] = $catalog[$id]['name'];
    }
    $description = count($descriptionParts) === 1
        ? substr($descriptionParts[0], 0, 100)
        : count($descriptionParts) . ' produtos';
    $reference = 'ADV-' . bin2hex(random_bytes(16));

    $gatewayPayload = [
        'amount' => $expectedAmount,
        'description' => $description,
        'reference' => $reference,
        'source' => 'api_externa',
        'customer' => [
            'name' => $name,
            'email' => $email,
            'document' => $document,
            'phone' => $phone,
        ],
        'address' => [
            'street' => $street,
            'number' => $number,
            'neighborhood' => $neighborhood,
            'city' => $city,
            'state' => $state,
            'zipcode' => $zipcode,
            'complement' => $complement,
        ],
    ];
    $postbackUrl = payment_postback_url();
    if ($postbackUrl !== null) {
        $gatewayPayload['postback_url'] = $postbackUrl;
    }

    $tracking = [];
    foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck'] as $key) {
        $value = payment_input_string($payload, $key);
        if ($value !== '') {
            $tracking[$key] = substr($value, 0, 500);
        }
    }
    if ($tracking !== []) {
        $gatewayPayload['tracking'] = $tracking;
    }

    payment_json_response(paradise_create_pix($gatewayPayload), 201);
} catch (PaymentApiException $error) {
    payment_error_response($error);
} catch (Random\RandomException) {
    error_log('[Payment] Falha ao gerar a referência do pedido.');
    payment_json_response(['code' => 'internal_error', 'error' => 'Não foi possível preparar o pagamento. Tente novamente.'], 500);
} catch (Throwable $error) {
    error_log('[Payment] Erro interno em create-pix.php (' . get_class($error) . ').');
    payment_json_response(['code' => 'internal_error', 'error' => 'Não foi possível gerar o Pix. Tente novamente.'], 500);
}
