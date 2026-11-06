import { Link } from "react-router";
import { bundledPacks } from "../../content/packs.ts";

const SRD = bundledPacks.find((p) => p.id === "srd");

/** Required on every page that shows SRD content (DPCGL 2.0 §4.1). */
export function ShortAttribution() {
  return (
    <p>
      <small>
        Includes material from the Daggerheart System Reference Document 2.0, © Critical Role, LLC, under the{" "}
        <a href="https://darringtonpress.com/license/">Darrington Press Community Gaming License</a>. Reformatted by DaggerPlayer.{" "}
        <Link to="/legal">Full attribution</Link>. DaggerPlayer is not affiliated with or endorsed by Darrington Press or Critical Role.
      </small>
    </p>
  );
}

export function LegalPage() {
  return (
    <article className="legal">
      <h1>Attribution and license</h1>
      <h2>Daggerheart SRD 2.0</h2>
      <p>{SRD?.attribution}</p>
      <p>
        The Daggerheart System Reference Document 2.0 is available at{" "}
        <a href="https://www.daggerheart.com/srd/">daggerheart.com/srd</a>. It is Public Game Content licensed under the{" "}
        <a href="https://darringtonpress.com/license/">Darrington Press Community Gaming License (DPCGL)</a>.
      </p>
      <h2>Modifications</h2>
      <ul>
        {SRD?.modifications.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <h2>Trademarks</h2>
      <p>
        Daggerheart™ is a trademark of Critical Role, LLC. DaggerPlayer is a Daggerheart™ Compatible tool and is not affiliated with,
        sponsored by or endorsed by Darrington Press or Critical Role.
      </p>
      <h2>Homebrew</h2>
      <p>Homebrew content is created by users, is marked "Homebrew", and is not part of the SRD. Only import content you have the right to use.</p>
    </article>
  );
}
