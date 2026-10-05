import type { Vessel } from "@/vessel";
import {
  formatCourse,
  formatName,
  formatPosition,
  formatSource,
  formatSpeed,
  formatTimestamp,
} from "@/vessel";

/**
 * Карточка выбранного судна. Кнопки закрытия нет: карточка закрывается только
 * выбором другого судна.
 *
 * Все значения подставляются как текстовые узлы React. Название приходит от
 * экипажа и может содержать разметку — React экранирует её, поэтому `<b>Демо</b>`
 * видно символами, а не жирным шрифтом.
 */
export default function VesselCard({ vessel }: { vessel: Vessel }) {
  const rows = [
    { label: "Идентификатор", value: vessel.id },
    { label: "Название", value: formatName(vessel.name) },
    { label: "Координаты", value: formatPosition(vessel.lat, vessel.lon) },
    { label: "Скорость", value: formatSpeed(vessel.speedKnots) },
    { label: "Курс", value: formatCourse(vessel.courseDeg) },
    { label: "Время", value: formatTimestamp(vessel.timestamp) },
    { label: "Источник", value: formatSource(vessel.source) },
  ];

  return (
    <section className="card" data-card-vessel-id={vessel.id}>
      <dl className="card-rows">
        {rows.map((row) => (
          <div className="card-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
