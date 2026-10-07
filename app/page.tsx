import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

export default function Home() {
  return <main className="simple-home">
    <section className="simple-home-card">
      <div className="simple-home-brand"><BrandLogo className="home-brand-logo" priority /><div><strong>P-Delivery</strong><small>Suyai + Aura</small></div></div>
      <div className="simple-home-heading"><span>ACCESO AL SISTEMA</span><h1>¿Cómo deseas ingresar?</h1></div>
      <div className="simple-portal-grid">
        <Link className="simple-portal-button admin" href="/acceso-admin"><span className="simple-portal-drawing" aria-hidden="true">🕒</span><strong>Administración</strong><small>Gestión, almacenes y reportes</small><b>Ingresar →</b></Link>
        <Link className="simple-portal-button courier" href="/acceso-motorizado"><span className="simple-portal-drawing" aria-hidden="true">🛵</span><strong>Motorizado</strong><small>Pedidos, entregas e historial</small><b>Ingresar →</b></Link>
      </div>
    </section>
  </main>;
}
