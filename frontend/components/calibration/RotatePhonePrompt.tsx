export function RotatePhonePrompt() {
  return (
    <div className="phone-rotate-prompt" role="dialog" aria-labelledby="rotate-phone-title">
      <div className="turn-phone" aria-hidden="true">
        <span className="turn-phone-speaker" />
      </div>
      <h2 id="rotate-phone-title" className="text-2xl font-bold">
        Gira tu celular
      </h2>
      <p className="mt-3 max-w-xs text-gray-300">
        Pon el teléfono en horizontal para usar la cámara y ver el análisis.
      </p>
    </div>
  );
}
