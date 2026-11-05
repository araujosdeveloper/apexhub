# Monitoramento da publicação

Instalado no host em 03/11/2026 às 18:06 UTC, conforme saída fornecida pelo
responsável. Timer ativo; primeira checagem com `ok: true` para HTTPS/API e
backups local/Drive. As execuções periódicas futuras ainda devem ser acompanhadas.

Execute `bash /root/delivery-saas/comando-configurar-monitoramento.txt`.
O instalador exige uma verificação inicial aprovada antes de habilitar o timer.
Não reinicia a aplicação nem altera dados da loja.

A cada cinco minutos, verifica o certificado HTTPS do IP público com a cadeia
confiável e alerta por falha quando faltam menos de 24 horas para vencer.
Confere `/api/health`, que consulta o banco, e exige backups local e remoto
verificados com menos de 36 horas. A data do backup enviado também é conferida,
para uma nova verificação de cópia antiga não esconder dados desatualizados.
Não baixa o Drive novamente: consulta o recibo do envio já verificado.
Não substitui a restauração semanal nem um monitor externo à VPS.

Consultar o último resultado:

```sh
cat /root/delivery-saas/reports/monitoring/latest.json
systemctl status delivery-live-monitor.timer --no-pager
journalctl -u delivery-live-monitor.service -n 50 --no-pager
```

Falhas geram código diferente de zero, estado de falha no serviço e registro no
journal. O timer tenta novamente no próximo ciclo. Não há notificação por e-mail
ou WhatsApp configurada. Se a própria VPS cair, o monitor local não executa.

Validação local: sintaxe shell e unidades systemd aprovadas; seis cenários de
backup cobriram sucesso, idade excessiva, data futura, recibo inválido, envio
antigo e manifesto ausente. HTTPS real e instalação dependem do host.
