"use client";

import { LAYERS, PARAMS, type Layer, type Values } from "../lib/params";

/**
 * The parameters of some layers, drawn from the table as ASCII keys (choices) and thin sliders (ranges).
 * Used by the SETUP box on the address page and by the PARAMS drawer in the Lab.
 */
export function ParamControls({ layers, values, onChange, dirty }: { layers: Layer[]; values: Values; onChange: (key: string, value: string) => void; dirty?: Set<string> }) {
  return (
    <div className="params">
      {LAYERS.filter((layer) => layers.includes(layer.id)).map((layer) => (
        <section key={layer.id} className="params__layer">
          <div className="params__title">{layer.title}</div>
          {PARAMS.filter((param) => param.layer === layer.id).map((param) => (
            <div key={param.key} className={`params__row${dirty?.has(param.key) ? " is-dirty" : ""}`} title={param.hint}>
              <span className="params__label">{param.label}</span>
              {param.kind === "choice" ? (
                <span className="params__choices">
                  {param.choices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      className={values[param.key] === choice.value ? "is-on" : "is-key"}
                      onClick={() => onChange(param.key, choice.value)}
                    >
                      [{choice.label}]
                    </button>
                  ))}
                </span>
              ) : (
                <span className="params__range">
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={Number(values[param.key])}
                    onChange={(event) => onChange(param.key, event.target.value)}
                    aria-label={param.label}
                  />
                  <output>{Number(values[param.key]) < 0 || (param.key === "bpm" && Number(values[param.key]) === 0) ? "STYLE" : values[param.key]}</output>
                </span>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
