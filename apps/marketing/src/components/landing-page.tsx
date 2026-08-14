import type { Content } from "@/lib/content";
import { localeHref } from "@/lib/content";
import { APP_URL, isDemoConfigured } from "@/lib/site";
import { requestDemo } from "@/app/actions";

import { Brand } from "./brand";
import { DemoForm } from "./demo-form";
import { ArrowDown, ArrowRight, Check, File } from "./icons";
import { DashboardVisual, FieldVisual, ProgressVisual, WorkflowVisual } from "./product-visuals";
import { SiteHeader } from "./site-header";

export function LandingPage({ t }: { t: Content }) {
  return (
    <div lang={t.locale}>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader t={t} />
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="page-shell hero-inner">
            <div className="hero-copy">
              <p className="eyebrow"><span />{t.hero.eyebrow}</p>
              <h1 id="hero-title">
                {t.hero.titleStart} <em>{t.hero.titleAccent}</em>
              </h1>
              <p className="hero-body">{t.hero.body}</p>
              <div className="hero-actions">
                <a href="#demo" className="button button-white">{t.hero.primary}<ArrowRight /></a>
                <a href="#workflow" className="button button-glass">{t.hero.secondary}<ArrowDown /></a>
              </div>
              <p className="hero-note"><Check />{t.hero.note}</p>
            </div>
            <div className="hero-product">
              <div className="product-caption"><span>PORTFOLIO / CONTOH COMPANY</span><span>V2 PRODUCT VIEW</span></div>
              <DashboardVisual />
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Product capabilities">
          <div className="page-shell proof-inner">
            <p>{t.locale === "id" ? "Dibangun untuk operasi konstruksi yang nyata:" : "Built for real construction operations:"}</p>
            <div className="proof-grid">
              {t.proof.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </section>

        <section className="section attention-section" id="product">
          <div className="page-shell">
            <div className="section-heading">
              <div><p className="eyebrow"><span />{t.attention.eyebrow}</p><h2>{t.attention.title}</h2></div>
              <p>{t.attention.body}</p>
            </div>
            <div className="principle-grid">
              {t.attention.bullets.map((item, index) => (
                <article key={item}>
                  <span>0{index + 1}</span>
                  <h3>{item}</h3>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section workflow-section" id="workflow">
          <div className="page-shell">
            <div className="section-heading">
              <div><p className="eyebrow"><span />{t.workflow.eyebrow}</p><h2>{t.workflow.title}</h2></div>
              <p>{t.workflow.body}</p>
            </div>
            <div className="workflow-demo">
              <div className="step-list">
                {t.workflow.steps.map((step, index) => (
                  <article key={step.number} className={index === 1 ? "active" : undefined}>
                    <span>{step.number}</span><div><h3>{step.title}</h3><p>{step.body}</p></div>
                  </article>
                ))}
              </div>
              <WorkflowVisual />
            </div>
          </div>
        </section>

        <section className="section progress-section">
          <div className="page-shell">
            <div className="section-heading">
              <div><p className="eyebrow"><span />{t.progress.eyebrow}</p><h2>{t.progress.title}</h2></div>
              <p>{t.progress.body}</p>
            </div>
            <div className="progress-layout">
              <div className="progress-stats">
                {t.progress.stats.map(([value, label], index) => <div key={label} data-danger={index === 2 || undefined}><strong>{value}</strong><span>{label}</span></div>)}
                <a href="#demo">{t.nav.demo}<ArrowRight /></a>
              </div>
              <ProgressVisual />
            </div>
          </div>
        </section>

        <section className="section field-section">
          <div className="page-shell">
            <div className="section-heading">
              <div><p className="eyebrow"><span />{t.field.eyebrow}</p><h2>{t.field.title}</h2></div>
              <p>{t.field.body}</p>
            </div>
            <div className="field-grid">
              {t.field.cards.map((card, index) => (
                <article key={card.title}>
                  <FieldVisual type={index === 0 ? "daily" : index === 1 ? "actions" : "notes"} />
                  <div className="field-copy"><span>0{index + 1}</span><h3>{card.title}</h3><p>{card.body}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section access-section" id="security">
          <div className="page-shell">
            <div className="section-heading">
              <div><p className="eyebrow"><span />{t.access.eyebrow}</p><h2>{t.access.title}</h2></div>
              <p>{t.access.body}</p>
            </div>
            <div className="access-list">
              {t.access.items.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}
            </div>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="page-shell faq-layout">
            <div className="faq-intro"><p className="eyebrow"><span />{t.faq.eyebrow}</p><h2>{t.faq.title}</h2></div>
            <div className="faq-list">
              {t.faq.items.map(([question, answer], index) => (
                <details key={question} name="faq">
                  <summary><span>0{index + 1}</span><strong>{question}</strong><i aria-hidden /></summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="demo-section" id="demo">
          <div className="page-shell demo-layout">
            <div className="demo-copy">
              <p className="eyebrow"><span />{t.demo.eyebrow}</p>
              <h2>{t.demo.title}</h2>
              <p>{t.demo.body}</p>
              <div className="demo-sequence" aria-hidden><span><File />BoQ</span><i /><span>Schedule</span><i /><span>Progress</span><i /><span>Decision</span></div>
            </div>
            <DemoForm t={t} action={requestDemo} configured={isDemoConfigured()} />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-shell footer-grid">
          <div><Brand inverse /><p>{t.footer.tagline}</p></div>
          <nav aria-label={t.footer.product}><strong>{t.footer.product}</strong><a href="#product">{t.nav.product}</a><a href="#workflow">{t.nav.workflow}</a><a href="#security">{t.nav.security}</a></nav>
          <nav aria-label={t.footer.legal}><strong>{t.footer.legal}</strong><a href={t.locale === "id" ? "/privacy" : "/en/privacy"}>{t.footer.privacy}</a><a href={t.locale === "id" ? "/terms" : "/en/terms"}>{t.footer.terms}</a></nav>
          <nav aria-label="Account"><strong>V2</strong><a href={`${APP_URL}/login`}>{t.nav.signIn}</a><a href={localeHref(t.alternateLocale)} lang={t.alternateLocale}>{t.languageName} → {t.alternateLabel}</a></nav>
        </div>
        <div className="page-shell footer-bottom"><span>© {new Date().getFullYear()} V2. {t.footer.rights}</span><span>BASELINE / PROGRESS / DECISION</span></div>
      </footer>
    </div>
  );
}
