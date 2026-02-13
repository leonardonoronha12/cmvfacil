insert into public.automation_messages (event_type, whatsapp_body)
values
  (
    'plan.free_pending_2',
    'Será que preciso de um App só pra Controlar CMV?\n\nPensa comigo...\n\n1. Você tá faturando bem, mas quase não tem Lucro\n2. Cortar gastos é a solução mais rápida\n3. CMV é o maior gasto de todos!\n\nNosso sistema te entrega o CMV Real de forma automática e te ajuda a reduzir ele em tempo recorde!\n\nCMV Controlado = Lucro Recuperado\n\nConclua seu cadastro: https://app.cmvfacil.com'
  ),
  (
    'plan.free_pending_3',
    'Como a Gold Burger LUCROU + R$ 40.000 usando o CMV Fácil...\n\nHamburgueria de sucesso, 3 lojas, faturando R$ 350 mil por mês...\n\nO problema? Igual ao seu:\n\n1. Fornecedor subindo preço\n2. Promoções agressivas pra não perder clientes\n3. Margem muito apertada\n\nCom o CMV Fácil, eles baixaram o CMV Real de 45% para 33%, ou seja, 12% de economia…\n\nR$ 350.000 x 12% = R$42.000,00 de LUCRO RECUPERADO!\n\nFaça o mesmo no seu Restaurante: https://app.cmvfacil.com'
  ),
  (
    'plan.free_pending_4',
    'Ficou com dúvida?\n\nResponda esta mensagem e o Renan (fundador do app) te ajuda.\n\nEnquanto isso, conclua seu cadastro: https://app.cmvfacil.com'
  ),
  (
    'plan.free_pending_5',
    'Última chance…\n\nSe você realmente quer aumentar o LUCRO do seu Restaurante, o CMV Fácil é a solução.\n\nJá recuperamos + R$ 1 milhão de lucro para nossos clientes.\n\nSeja o próximo: https://app.cmvfacil.com'
  )
on conflict (event_type)
do update set
  whatsapp_body = excluded.whatsapp_body;

