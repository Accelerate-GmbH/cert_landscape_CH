# Verification of the critical-services list

Checked: 2026-11-19T21:16:16Z · list: `/home/runner/work/cert_landscape_CH/cert_landscape_CH/data/critical_services/critical_services_ch.csv`

| | Hosts |
|---|---|
| listed | 1000 |
| resolve in public DNS | 1000 |
| answer over HTTPS | 834 |
| source page still links the host | 364 of 374 |

## Failing in two or more consecutive checks (review)

- account.ail.ch
- account.swissix.ch
- api.ail.ch
- api.axa.ch
- api.axpo.com
- api.bcge.ch
- api.bcj.ch
- api.bis.org
- api.blick.ch
- api.css.ch
- api.elca.ch
- api.epfl.ch
- api.healthreg.admin.ch
- api.lombardodier.com
- api.postfinance.ch
- api.srf.ch
- api.stadtluzern.ch
- api.swissgrid.ch
- api.t-l.ch
- api.tcs.ch
- api.ubs.com
- api.usz.ch
- api.viseca.ch
- app.bcge.ch
- app.eda.admin.ch
- app.h-fr.ch
- app.hirslanden.ch
- app.icrc.org
- app.rega.ch
- app.swissquote.ch
- app.ti.ch
- auth-pams.estv.admin.ch
- auth.aew.ch
- auth.alpiq.com
- auth.ekz.ch
- auth.elca.ch
- auth.groupe-e.ch
- auth.helvetia.ch
- auth.primeo-energie.ch
- auth.salt.ch
- auth.so.ch
- auth.stgag.ch
- auth.sunrise.ch
- auth.swissport.com
- auth.trust-infra.swiyu.admin.ch
- auth.unil.ch
- auth.usz.ch
- auth.uzh.ch
- banking.credit-suisse.com
- banking.postfinance.ch
- customer.axpo.com
- e-banking.ubs.com
- ebanking.ubs.com
- equinix.ch
- id.ubs.com
- id.uzh.ch
- id.vd.ch
- login.ag.ch
- login.bkb.ch
- login.cler.ch
- login.eda.admin.ch
- login.ethz.ch
- login.ewb.ch
- login.ewl-luzern.ch
- login.gr.ch
- login.helvetia.ch
- login.hug.ch
- login.inventx.ch
- login.ksbl.ch
- login.ksw.ch
- login.primeo-energie.ch
- login.roche.com
- login.rts.ch
- login.sh.ch
- login.six-group.com
- login.snb.ch
- login.sunrise.ch
- login.suva.ch
- login.swiss.com
- login.swissgas.ch
- login.swisslife.ch
- login.tagesanzeiger.ch
- login.tg.ch
- login.uzh.ch
- mwsteasy.estv.admin.ch
- my.brack.ch
- my.cscs.ch
- my.ebm.ch
- my.elca.ch
- my.ewb.ch
- my.helvetia.ch
- my.sbbcargo.com
- my.sgsw.ch
- my.srgssr.ch
- my.tcs.ch
- online.iwb.ch
- online.migros.ch
- online.stadt.sg.ch
- portal.appkb.ch
- portal.bsv.admin.ch
- portal.datatrans.ch
- portal.ewl-luzern.ch
- portal.hirslanden.ch
- portal.ksbl.ch
- portal.ksgr.ch
- portal.ksw.ch
- portal.medgate.ch
- portal.sfbvg.ch
- portal.stadt.sg.ch
- portal.swica.ch
- portal.swissgas.ch
- portal.swissmedic.ch
- portal.trust-infra.swiyu.admin.ch
- portal.viseca.ch
- portal.vs.ch
- secure.aet.ch
- secure.bedag.ch
- secure.migros.ch
- secure.six-group.com
- secure.six-securities-services.com
- shop.20min.ch
- shop.gkb.ch
- shop.rega.ch
- shop.rsi.ch
- shop.sanitas.com
- shop.swisscom.ch
- shop.tagesanzeiger.ch
- shop.ubs.com
- sso.adnovum.com
- sso.blkb.ch
- sso.ekz.ch
- sso.lonza.com
- sso.lugano.ch
- sso.salt.ch
- sso.skribble.com
- sso.sunrise.ch
- sso.swissport.com
- sso.switch.ch
- user.eportal.admin.ch
- vzc-api.astra.admin.ch
- webmail.axpo.com
- ws.api.astra.admin.ch
- www.axsana.ch
- www.bger.ch
- www.brack.ch
- www.bstger.ch
- www.chaeis.ch
- www.ebm.ch
- www.ensi.ch
- www.kapo.zh.ch
- www.kkl.ch
- www.medidata.ch
- www.ofac.ch
- www.stadtwerk.winterthur.ch
- www.swiyu.admin.ch
- www.winterthur.ch

## Source page no longer links the host (two or more checks)

- account.proton.me
- www.bancastato.ch
- www.compenswiss.ch
- www.ruag.ch
- www.swissix.ch
- www.tagesanzeiger.ch

## Changed since the last check

- account.post.ch
- api.bcv.ch
- auth.bcv.ch
- my.groupe-e.ch
- secure.axa.ch
- shop.axpo.com
- webmail.switch.ch
- www.bcv.ch
- www.biel-bienne.ch
- www.carbura.ch
- www.gl.ch
- www.koeniz.ch
- www.sg.ch
- www.sgsw.ch
- www.stadt.sg.ch
- www.stadtluzern.ch
- www.ur.ch

Operator data (UID, seat) is checked separately against the UID register with
`tools/critical_services/runuid.py`; this check does not change the list.
