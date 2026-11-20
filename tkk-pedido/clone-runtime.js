(function () {
  'use strict';
  // Keep the mirrored UI intact; adapt only the local commerce contract.
  var nativeFetch = window.fetch.bind(window);
  var paradiseTokenPattern = /^[A-Za-z0-9_-]{2,214}\.[a-f0-9]{64}$/;
  window.tkkIsParadiseTxid = function (value) {
    return typeof value === 'string' && paradiseTokenPattern.test(value);
  };
  function read(storage, key, fallback) {
    try { var raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }
  function get(storage, key) { try { return storage.getItem(key) || ''; } catch (_) { return ''; } }
  function set(storage, key, value) { try { storage.setItem(key, value); } catch (_) {} }
  window.tkkNationalPhoneDigits = function (value) {
    var digits = String(value || '').replace(/\D/g, '');
    return /^55\d{10,11}$/.test(digits) ? digits.slice(2) : digits;
  };
  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    var pending = read(sessionStorage, 'pending_sealpay_request', null);
    var preview = pending && pending.preview;
    if (!preview) preview = read(sessionStorage, 'sealpay_order_preview', null);
    var previewItems = preview && Array.isArray(preview.checkoutItems) ? preview.checkoutItems : [];
    var out = Object.assign({}, payload);
    out.items = (Array.isArray(payload.items) ? payload.items : []).map(function (item, index) {
      var copy = Object.assign({}, item);
      var reference = previewItems[index];
      if (!reference || reference.nome !== item.nome) {
        reference = previewItems.find(function (candidate) { return candidate.nome === item.nome; });
      }
      if (!copy.id && reference && reference.id != null) copy.id = String(reference.id);
      if (copy.id != null) copy.id = String(copy.id);
      if (!copy.variacao && reference && reference.variacao) copy.variacao = reference.variacao;
      return copy;
    });
    if (out.items.some(function (item) { return item.id === '109'; })) {
      var meta = read(localStorage, 'gts_order_meta', {});
      out.couponApplied = preview && typeof preview.couponApplied === 'boolean'
        ? preview.couponApplied
        : !!(meta.couponApplied || get(sessionStorage, 'gts_coupon_10_applied') === '1');
    }
    var key = payload.idempotency_key || (pending && pending._tkk_idempotency);
    if (!key && pending) key = 'tkk-' + window.crypto.randomUUID();
    if (key) out.idempotency_key = key;
    if (pending) {
      pending._tkk_idempotency = key;
      pending.payload = out;
      set(sessionStorage, 'pending_sealpay_request', JSON.stringify(pending));
    }
    return out;
  }
  window.fetch = function (input, init) {
    var target;
    try { target = new URL(typeof input === 'string' ? input : input.url, window.location.href); } catch (_) { return nativeFetch(input, init); }
    if (target.hostname === 'tkk-pedido.site' && target.pathname.indexOf('/tkk-pedido/api/') === 0) {
      input = target.pathname + target.search;
      target = new URL(input, window.location.origin);
    }
    if (target.origin === window.location.origin && target.pathname === '/tkk-pedido/api/create-pix' && init && typeof init.body === 'string') {
      try { init = Object.assign({}, init, { body: JSON.stringify(normalizePayload(JSON.parse(init.body))) }); } catch (_) {}
    }
    return nativeFetch(input, init);
  };

  var cachedToken = get(sessionStorage, 'sealpay_txid');
  if (cachedToken && !window.tkkIsParadiseTxid(cachedToken) && !/^tk_[a-f0-9]{48}$/.test(cachedToken)) {
    ['sealpay_txid', 'sealpay_pix_code', 'sealpay_qr_code_base64'].forEach(function (key) { try { sessionStorage.removeItem(key); } catch (_) {} });
  }

  function installAddressPrompt() {
    if (!document.body || typeof document.querySelector !== 'function') return;
    var inCheckout = false;
    var prompt;
    var previousOverflow = '';
    var addressFields = ['cep', 'cidade', 'rua', 'numero', 'bairro', 'uf'];
    function addressComplete(form) {
      return addressFields.every(function (name) {
        var field = form && form.querySelector('[name="' + name + '"]');
        var value = field ? field.value : get(localStorage, 'user_' + (name === 'uf' ? 'estado' : name));
        return name === 'cep' ? value.replace(/\D/g, '').length === 8 : value.trim().length > 0;
      });
    }
    function createPrompt() {
      var style = document.createElement('style');
      // Same card typography, spacing and colors as sabonete2's addr-prompt.
      style.textContent = '#tkk-address-prompt{box-sizing:border-box;width:286px;max-width:calc(100vw - 44px);padding:0;border:0;border-radius:14px;background:#fff;color:#161823;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;text-align:center;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,.2)}'+
        '#tkk-address-prompt::backdrop{background:rgba(0,0,0,.45)}'+
        '#tkk-address-prompt h3{margin:22px 22px 8px;font-size:17px;font-weight:700;line-height:1.25;color:#161823}'+
        '#tkk-address-prompt p{margin:0 20px 20px;color:#8a8b91;font-size:13.5px;font-weight:400;line-height:1.45}'+
        '#tkk-address-prompt .tkk-address-actions{display:flex;border-top:1px solid #ececee}'+
        '#tkk-address-prompt button{box-sizing:border-box;flex:1;min-width:0;height:46px;margin:0;padding:0;border:0;border-radius:0;background:#fff;font:inherit;font-size:16px;color:#161823;cursor:pointer}'+
        '#tkk-address-prompt button+button{border-left:1px solid #ececee;font-weight:700}'+
        '#tkk-address-prompt button:focus-visible{outline:2px solid #111;outline-offset:-2px}';
      document.head.appendChild(style);
      prompt = document.createElement('dialog');
      prompt.id = 'tkk-address-prompt';
      prompt.setAttribute('aria-labelledby', 'tkk-address-title');
      prompt.setAttribute('aria-describedby', 'tkk-address-description');
      prompt.innerHTML = '<h3 id="tkk-address-title">Adicionar endereço de entrega</h3>'+
        '<p id="tkk-address-description">Sua conta não tem um endereço de envio. Adicione um para prosseguir com a finalização da compra.</p>'+
        '<div class="tkk-address-actions"><button type="button" data-address-later>Mais tarde</button><button type="button" data-address-add autofocus>Adicionar</button></div>';
      prompt.querySelector('[data-address-later]').addEventListener('click', function () { prompt.close(); });
      prompt.querySelector('[data-address-add]').addEventListener('click', function () {
        prompt.close();
        if (document.getElementById('address-modal-box') && typeof window.openAddressModalLocal === 'function') {
          window.openAddressModalLocal();
          var legacyField = document.getElementById('addr-cep');
          if (legacyField) legacyField.focus();
        } else {
          var cartAddress = document.querySelector('.cart-address [data-action="checkout"]');
          if (cartAddress) cartAddress.click();
          var form = document.getElementById('checkout-form');
          var field = form && addressFields.map(function (name) { return form.querySelector('[name="' + name + '"]'); }).find(function (input) { return input && !input.value.trim(); });
          if (!field && form) field = form.querySelector('[name="cep"]');
          if (field) { field.scrollIntoView({block:'center'}); field.focus({preventScroll:true}); }
        }
      });
      prompt.addEventListener('close', function () { document.documentElement.style.overflow = previousOverflow; });
      document.body.appendChild(prompt);
    }
    function checkCheckout() {
      var form = document.getElementById('checkout-form');
      // The order summary (cartView) is the checkout entry, before the address form.
      var isCheckout = !!document.querySelector('.cart-page') || !!document.getElementById('address-details-box');
      if (!isCheckout) {
        inCheckout = false;
        if (prompt && prompt.open) prompt.close();
        return;
      }
      if (inCheckout) return;
      inCheckout = true;
      if (addressComplete(form)) return;
      if (!prompt) createPrompt();
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      prompt.showModal();
    }
    var observer = new MutationObserver(checkCheckout);
    observer.observe(document.body, {childList:true,subtree:true});
    checkCheckout();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAddressPrompt, {once:true});
  else installAddressPrompt();

  // Tracking pages use the dedicated API-driven tracking-runtime.js.
})();
