(function () {
  'use strict';
  var pathname=window.location.pathname.replace(/\/+$/,'');
  if(!/\/(?:acompanhamento|rastreio)(?:\.html)?$/.test(pathname))return;
  document.documentElement.style.visibility='hidden';
  var base=String(window.__TKK_BASE_PATH__||(/^\/tkk-pedido(?:\/|$)/.test(pathname)?'/tkk-pedido':'')).replace(/\/+$/,'');
  var TOKEN=/^tk_[a-f0-9]{48}$/;
  var currentToken='',currentOrder=null,requestNumber=0;
  var paymentLabels={pending:'Aguardando pagamento',paid:'Pagamento Pix confirmado',expired:'Pix expirado',cancelled:'Pagamento cancelado',canceled:'Pagamento cancelado',rejected:'Pagamento não aprovado',failed:'Pagamento não concluído',refunded:'Pagamento estornado',chargeback:'Contestação registrada'};
  var shippingLabels={awaiting_postage:'Aguardando postagem',preparing:'Pedido em preparação',posted:'Pedido postado',in_transit:'Pedido em transporte',out_for_delivery:'Saiu para entrega',delivered:'Entrega registrada',exception:'Ocorrência na entrega',returned:'Devolução registrada',cancelled:'Envio cancelado'};
  function element(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=String(text);return node;}
  function byId(id){return document.getElementById(id);}
  function text(id,value){var node=byId(id);if(node)node.textContent=value;}
  function queryText(selector,value){document.querySelectorAll(selector).forEach(function(node){node.textContent=value;});}
  function visible(node,show){if(node){node.hidden=!show;node.style.display=show?'':'none';}}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function date(value){var time=new Date(value);return isNaN(time.getTime())?'':time.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function get(storage,key){try{return storage.getItem(key)||'';}catch(_){return '';}}
  function set(storage,key,value){try{storage.setItem(key,value);}catch(_){}}
  function safeUrl(value){try{var url=new URL(value,window.location.origin);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch(_){return '';}}
  function localImage(value){if(!value)return '';var source=String(value);if(source.charAt(0)==='/'&&base&&source.indexOf(base+'/')!==0)return base+source;return source;}
  function tokenFrom(value){
    value=String(value||'').trim();if(TOKEN.test(value))return value;
    try{var url=new URL(value,window.location.origin);var token=url.searchParams.get('pedido')||url.searchParams.get('txid');return TOKEN.test(token||'')?token:'';}catch(_){return '';}
  }
  function message(value,isError){var node=byId('tkk-tracking-message');if(node){node.textContent=value;node.style.color=isError?'#b42318':'#475569';}}
  function orderAreas(show){document.querySelectorAll('.tk-main-grid,.tk-order-summary-card,.lg-grid').forEach(function(node){visible(node,show);});}
  function link(id,href,label){var node=byId(id);if(!node)return;if(href)node.setAttribute('href',href);else node.removeAttribute('href');if(label)node.textContent=label;visible(node,!!href);}
  function clearInvoice(){
    var card=byId('nota-fiscal');
    if(card){card.replaceChildren(element('p','tk-section-tag','DOCUMENTO DA COMPRA'),element('h2','tk-nf-title','Nota fiscal'),element('p','tk-nf-date','Nota fiscal ainda não disponibilizada.'));card.hidden=false;card.style.display='';}
    text('lg-nfe-summary','Nota fiscal ainda não disponibilizada');
    var summary=byId('lg-nfe-summary');
    if(summary&&summary.parentElement&&summary.parentElement.parentElement){var box=summary.closest('[data-tkk-invoice-summary]')||summary.parentElement.parentElement;box.setAttribute('data-tkk-invoice-summary','1');box.replaceChildren(element('strong','','Nota fiscal ainda não disponibilizada'));box.firstChild.id='lg-nfe-summary';}
    link('lg-nfe-link','','');
    window.downloadOrPrintDanfe=function(){};
    window.__nfeNumber='';window.__nfeRawKey='';window.__trackingCode='';
    ['gts_nfe_meta','gts_loggi_tracking'].forEach(function(key){try{localStorage.removeItem(key);}catch(_){}});
  }
  function renderInvoice(invoice){
    clearInvoice();if(!invoice||!invoice.number||!safeUrl(invoice.url))return;
    var card=byId('nota-fiscal');
    if(card){
      card.replaceChildren(element('p','tk-section-tag','DOCUMENTO DA COMPRA'),element('h2','tk-nf-title','Nota fiscal'),element('p','tk-nf-meta','NF '+invoice.number),element('p','tk-nf-date','Emitida em '+date(invoice.issuedAt)));
      if(invoice.accessKey)card.appendChild(element('p','tk-nf-key-text',invoice.accessKey));
      var anchor=element('a','tk-btn-outline','Abrir nota fiscal emitida');anchor.href=safeUrl(invoice.url);anchor.target='_blank';anchor.rel='noopener noreferrer';card.appendChild(anchor);
    }
    text('lg-nfe-summary','NF '+invoice.number);
    link('lg-nfe-link',safeUrl(invoice.url),'Abrir nota fiscal emitida');
    var external=byId('lg-nfe-link');if(external){external.target='_blank';external.rel='noopener noreferrer';}
  }
  function addressContent(order,prefix){
    var customer=order.customer||{},address=order.address||{},parts=[];
    if(address.rua||address.numero)parts.push([address.rua,address.numero].filter(Boolean).join(', '));
    if(address.complemento)parts.push(address.complemento);
    if(address.bairro)parts.push(address.bairro);
    if(address.cidade||address.estado||address.uf)parts.push([address.cidade,address.estado||address.uf].filter(Boolean).join('/'));
    if(address.cep)parts.push('CEP '+address.cep);
    var fragment=document.createDocumentFragment();fragment.appendChild(element('p',prefix+'-addr-name',customer.name||''));fragment.appendChild(element('p',prefix+'-addr-lines',parts.join(' · ')));
    var contact=[customer.email,customer.phone].filter(Boolean).join(' · ');if(contact)fragment.appendChild(element('p',prefix+'-addr-contact',contact));return fragment;
  }
  function renderItems(order){
    ['tk-items-list','lg-items-box'].forEach(function(id){
      var box=byId(id);if(!box)return;box.replaceChildren();
      (order.items||[]).forEach(function(item){
        var isMain=id==='tk-items-list',row=element('div',isMain?'tk-product-row':'lg-prod-row');
        if(item.img){var image=element('img',isMain?'tk-product-thumb':'lg-prod-img');image.src=localImage(item.img);image.alt=item.nome||'Produto';row.appendChild(image);}
        var info=element('div',isMain?'tk-product-info':'');info.appendChild(element(isMain?'h2':'div',isMain?'tk-product-title':'lg-prod-name',item.nome||'Produto'));
        info.appendChild(element('div',isMain?'tk-product-meta':'lg-prod-meta',[item.variacao,'Quantidade: '+item.qty].filter(Boolean).join(' · ')));
        if(isMain)info.appendChild(element('p','tk-product-price',money(Number(item.preco)*Number(item.qty))));row.appendChild(info);box.appendChild(row);
      });
    });
    var summary=byId('tk-fin-summary');
    if(summary){
      summary.replaceChildren();
      if(order.couponDiscount){var discount=element('div','tk-fin-line is-green');discount.append(element('span','','Cupom aplicado'),element('strong','',money(-order.couponDiscount)));summary.appendChild(discount);}
      var total=element('div','tk-fin-total-row');total.append(element('span','',order.paymentStatus==='paid'?'Total pago':'Total do pedido'),element('span','tk-total-paid-badge',money(order.amount)));summary.appendChild(total);
    }
  }
  function renderTimeline(events){
    var main=document.querySelector('.tk-timeline'),tracking=byId('lg-timeline-list');
    if(main)main.replaceChildren();if(tracking)tracking.replaceChildren();
    (events||[]).forEach(function(event){
      if(main){var step=element('div','tk-tl-step is-done'),dot=element('div','tk-tl-dot','✓'),info=element('div','');info.append(element('div','tk-tl-title',event.title),element('div','tk-tl-desc',[date(event.occurredAt),event.description,event.location].filter(Boolean).join(' · ')));step.append(dot,info);main.appendChild(step);}
      if(tracking){var row=element('div','lg-tl-item is-done'),node=element('div','lg-tl-node','✓'),content=element('div','lg-tl-content'),top=element('div','lg-tl-row-top');top.append(element('div','lg-tl-title',event.title),element('span','lg-tl-time',date(event.occurredAt)));content.append(top,element('p','lg-tl-desc',event.description||''));if(event.location)content.appendChild(element('span','lg-tl-loc',event.location));row.append(node,content);tracking.appendChild(row);}
    });
    if(!events||!events.length){if(main)main.appendChild(element('p','tk-tl-desc','Nenhuma atualização registrada.'));if(tracking)tracking.appendChild(element('p','lg-tl-desc','Nenhuma atualização registrada.'));}
  }
  function render(order){
    currentOrder=order;var fulfillment=order.fulfillment||{},payment=order.paymentStatus||order.status||'pending';
    var paymentLabel=paymentLabels[payment]||'Pagamento em conferência';
    var shipmentLabel=shippingLabels[fulfillment.status]||'Envio não informado';
    var chip=document.querySelector('.tk-approved-chip');if(chip){chip.textContent=paymentLabel;chip.style.color=payment==='paid'?'#087f5b':'#925f00';chip.style.background=payment==='paid'?'#e9f9f0':'#fff7df';}
    text('lg-live-chip',paymentLabel);queryText('.tk-status-title',shipmentLabel);text('lg-status-headline',shipmentLabel);
    text('tk-order-num',order.orderNumber||'');text('lg-order-num',order.orderNumber||'');text('tk-order-date',date(order.createdAt));
    var code=fulfillment.trackingCode||'';text('tk-tracking-code',code||'Aguardando postagem');text('lg-tracking-code',code||'Aguardando postagem');
    queryText('.tk-track-avail',code?'Código informado pela loja':'Código ainda não disponível');
    visible(byId('tk-copy-track-btn'),!!code);visible(byId('lg-copy-code-btn'),!!code);
    var carrier=fulfillment.carrier||'Transportadora ainda não informada';text('tkk-carrier-name',carrier);queryText('.lg-code-main .lg-meta-lbl','Código de rastreio · '+carrier);
    var logo=document.querySelector('.tk-loggi-logo');if(logo)visible(logo,fulfillment.carrier==='Loggi');
    var estimate=fulfillment.estimatedDelivery?date(fulfillment.estimatedDelivery):'Prazo ainda não informado';text('tk-eta-window',estimate);text('lg-eta-text',estimate);
    text('lg-status-updated',fulfillment.updatedAt?'Envio atualizado em '+date(fulfillment.updatedAt):'Nenhuma atualização de envio registrada.');
    var progress={awaiting_postage:0,preparing:25,posted:50,in_transit:65,out_for_delivery:85,delivered:100,exception:50,returned:100,cancelled:0}[fulfillment.status]||0;
    var fill=byId('lg-progress-fill');if(fill)fill.style.width=progress+'%';
    document.querySelectorAll('.lg-progress-labels span').forEach(function(node,index){node.textContent=['Pedido registrado','Preparação','Postagem','Entrega'][index]||'';node.className=progress>=index*33?'is-done':'';});
    link('tk-loggi-link',base+'/rastreio?pedido='+encodeURIComponent(currentToken),'Ver acompanhamento da entrega');
    link('lg-order-link',base+'/acompanhamento?pedido='+encodeURIComponent(currentToken),'Ver resumo completo do pedido');
    var carrierLink=byId('tkk-carrier-external');if(carrierLink){carrierLink.href=safeUrl(fulfillment.trackingUrl)||'#';visible(carrierLink,!!safeUrl(fulfillment.trackingUrl));carrierLink.textContent='Consultar na transportadora '+(fulfillment.carrier||'');}
    renderItems(order);var mainAddress=byId('tk-addr-body'),trackingAddress=byId('lg-address-box');if(mainAddress)mainAddress.replaceChildren(addressContent(order,'tk'));if(trackingAddress)trackingAddress.replaceChildren(addressContent(order,'lg'));
    renderTimeline(order.timeline&&order.timeline.events||fulfillment.events||[]);renderInvoice(fulfillment.invoice||order.nfe);
    var pay=byId('tkk-resume-payment');visible(pay,payment==='pending');
    orderAreas(true);message('Pagamento e envio são atualizados separadamente. Somente eventos registrados são exibidos.');
  }
  async function load(token){
    if(!TOKEN.test(token||'')){message('Informe o identificador ou o link de acompanhamento do pedido.',true);orderAreas(false);return;}
    currentToken=token;var serial=++requestNumber;message('Consultando pedido…');
    try{
      var response=await window.fetch(base+'/api/order-tracking/'+encodeURIComponent(token),{cache:'no-store'});
      if(serial!==requestNumber)return;
      if(!response.ok)throw Error(response.status===404?'Pedido não encontrado. Confira o identificador do seu pedido.':'Não foi possível consultar o pedido. Tente novamente.');
      var data=await response.json();if(!data.order||data.order.txid!==token)throw Error('Não foi possível conferir este pedido.');
      render(data.order);set(sessionStorage,'sealpay_txid',token);set(localStorage,'last_main_txid',token);
      var url=new URL(window.location.href);url.searchParams.set('pedido',token);url.searchParams.delete('codigo');url.searchParams.delete('code');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    }catch(caught){if(serial!==requestNumber)return;currentOrder=null;orderAreas(false);message(caught.message||'Não foi possível consultar o pedido.',true);}
    finally{document.documentElement.style.visibility='';}
  }
  async function resumePayment(){
    if(!currentOrder||!TOKEN.test(currentToken))return;
    message('Abrindo o Pix deste pedido…');
    try{
      var response=await window.fetch(base+'/api/payment-status/'+encodeURIComponent(currentToken),{cache:'no-store'}),payment=await response.json();
      if(!response.ok||payment.txid!==currentToken)throw Error();
      if(payment.status==='paid'){await load(currentToken);return;}
      set(sessionStorage,'sealpay_txid',currentToken);set(sessionStorage,'sealpay_pix_code',payment.pix_code||'');set(sessionStorage,'sealpay_qr_code_base64',payment.qr_code_base64||'');set(sessionStorage,'sealpay_total',(payment.amount/100).toFixed(2));
      set(sessionStorage,'sealpay_order_preview',JSON.stringify({total:(payment.amount/100).toFixed(2),checkoutItems:currentOrder.items,delivery:{name:currentOrder.customer.name,email:currentOrder.customer.email,phone:currentOrder.customer.phone,address:currentOrder.address}}));
      try{sessionStorage.removeItem('pending_sealpay_request');}catch(_){}
      window.location.assign(base+'/oferta/pagamento?pedido='+encodeURIComponent(currentToken));
    }catch(_){message('Não foi possível abrir o Pix. Tente novamente.',true);}
  }
  function setup(){
    document.querySelectorAll('[onclick]').forEach(function(node){node.removeAttribute('onclick');});document.querySelectorAll('[onsubmit]').forEach(function(node){node.removeAttribute('onsubmit');});
    document.title='Acompanhamento do pedido';
    queryText('.tk-intro-sub','Consulte o pagamento e as atualizações reais de envio do seu pedido.');
    queryText('.lg-hero h1','Acompanhe sua entrega');queryText('.lg-hero-sub','Consulte o pagamento, o código de rastreio e os eventos informados para o seu pedido.');queryText('.lg-hero-eyebrow span','ACOMPANHAMENTO DO PEDIDO');queryText('.lg-secure-pill span','Consulta do pedido');queryText('.lg-free-tag','Frete grátis');
    var brand=document.querySelector('.lg-brand-group');if(brand)brand.replaceChildren(element('strong','','Central de acompanhamento'));
    queryText('.lg-footer','Atualizações de envio registradas pela loja. Consulte a transportadora quando houver um código de rastreio.');queryText('.tk-footer','Acompanhamento de pedidos · Atualizações registradas pela loja.');
    document.querySelectorAll('.tk-tiktok-notice,.tk-email-card').forEach(function(node){visible(node,false);});
    queryText('.tk-carrier-pill','Atualizações do envio');
    var carrierBox=document.querySelector('.tk-carrier-top > div');if(carrierBox){var carrierName=element('strong','','Transportadora ainda não informada');carrierName.id='tkk-carrier-name';carrierBox.appendChild(carrierName);}
    var logo=document.querySelector('.tk-loggi-logo');visible(logo,false);
    var form=byId('lg-search-form'),input=byId('lg-search-input');
    if(!form){
      form=element('form','');form.id='tkk-order-search';form.style.cssText='display:flex;gap:8px;margin:18px 0;flex-wrap:wrap';
      input=element('input','');input.id='tkk-order-search-input';input.style.cssText='flex:1;min-width:190px;padding:12px;border:1px solid #d1d5db;border-radius:8px;font:inherit';
      var submit=element('button','tk-btn-outline','Consultar');submit.type='submit';submit.style.cssText='width:auto;padding:10px 16px;margin:0';form.append(input,submit);
      var intro=document.querySelector('.tk-intro');if(intro)intro.appendChild(form);
    }
    input.placeholder='Identificador ou link de acompanhamento do pedido';input.setAttribute('aria-label','Identificador do pedido');
    var notice=element('p','','Informe o identificador ou o link de acompanhamento do seu pedido.');notice.id='tkk-tracking-message';notice.setAttribute('role','status');notice.style.cssText='font-size:13px;line-height:1.5;margin:10px 0';form.insertAdjacentElement('afterend',notice);
    form.addEventListener('submit',function(event){event.preventDefault();load(tokenFrom(input.value));});
    var actions=element('div','');actions.style.cssText='display:flex;gap:12px;flex-wrap:wrap;margin:12px 0';var refresh=element('button','tk-btn-ghost','Atualizar');refresh.type='button';refresh.addEventListener('click',function(){if(currentToken)load(currentToken);});var pay=element('button','tk-btn-outline','Pagar Pix deste pedido');pay.type='button';pay.id='tkk-resume-payment';pay.addEventListener('click',resumePayment);visible(pay,false);actions.append(refresh,pay);notice.insertAdjacentElement('afterend',actions);
    ['tk-copy-track-btn','lg-copy-code-btn'].forEach(function(id){var button=byId(id);if(button)button.addEventListener('click',function(){var code=currentOrder&&currentOrder.fulfillment&&currentOrder.fulfillment.trackingCode;if(code&&navigator.clipboard)navigator.clipboard.writeText(code).then(function(){message('Código copiado.');}).catch(function(){message('Copie o código exibido na página.');});});visible(button,false);});
    var strip=document.querySelector('.lg-code-strip');if(strip){var external=element('a','lg-btn-secondary','Consultar na transportadora');external.id='tkk-carrier-external';external.target='_blank';external.rel='noopener noreferrer';visible(external,false);strip.appendChild(external);}
    document.querySelectorAll('.lg-faq-item').forEach(function(item,index){
      var button=item.querySelector('.lg-faq-btn'),answer=item.querySelector('.lg-faq-ans');var content=[['Quando o rastreio aparece?','O código fica disponível quando a loja registrar os dados reais da postagem.'],['Como as atualizações aparecem?','A página mostra os eventos de envio registrados para este pedido.'],['Qual é o prazo de entrega?','A previsão aparece quando uma data for informada para a sua remessa.'],['Onde consultar a transportadora?','Use o link da transportadora quando ele estiver disponível no acompanhamento.']][index];
      if(button&&answer&&content){button.textContent=content[0];answer.textContent=content[1];button.addEventListener('click',function(){item.classList.toggle('is-open');});}
    });
    clearInvoice();text('tk-tracking-code','Não informado');text('lg-tracking-code','Não informado');text('lg-order-num','Não consultado');text('tk-order-num','Não consultado');text('tk-order-date','');text('lg-eta-text','Prazo ainda não informado');text('tk-eta-window','Prazo ainda não informado');text('lg-status-headline','Informe o identificador do pedido');text('lg-live-chip','Pedido não consultado');text('lg-status-updated','');queryText('.tk-status-title','Pedido não consultado');queryText('.tk-approved-chip','Pedido não consultado');queryText('.tk-track-avail','Código ainda não disponível');
    var fill=byId('lg-progress-fill');if(fill)fill.style.width='0%';document.querySelectorAll('.lg-progress-labels span').forEach(function(node,index){node.textContent=['Pedido','Preparação','Postagem','Entrega'][index]||'';node.className='';});orderAreas(false);
    var params=new URLSearchParams(window.location.search),explicit=params.get('pedido')||params.get('txid');
    var initial=explicit||get(sessionStorage,'sealpay_txid')||get(localStorage,'last_main_txid');
    if(TOKEN.test(initial||'')){input.value=initial;load(initial);}else{document.documentElement.style.visibility='';if(explicit)message('Identificador inválido. Use o link de acompanhamento do pedido.',true);}
    window.setInterval(function(){if(currentToken&&!document.hidden)load(currentToken);},30000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
