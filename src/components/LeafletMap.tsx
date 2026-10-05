"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { AREA_BOUNDS, INITIAL_VIEW, TILE_LAYER } from "@/config";
import type { Vessel } from "@/vessel";

const ICON_SIZE = 24;

/**
 * Значок судна. Курс есть — треугольник, повёрнутый по курсу: 0° смотрит на
 * север, отсчёт по часовой стрелке, как у азимута. Курса нет — нейтральный
 * круг: поворачивать не по чему, и вид должен это показывать.
 *
 * Идентификатор устанавливается через DOM API, а не интерполируется в HTML.
 */
function vesselIcon(vessel: Vessel) {
  const hasCourse = vessel.courseDeg !== null;
  const shape = hasCourse
    ? `<svg viewBox="0 0 24 24" width="${ICON_SIZE}" height="${ICON_SIZE}" style="transform: rotate(${vessel.courseDeg}deg)"><path d="M12 2 L20 22 L12 17 L4 22 Z" fill="#1d4ed8" stroke="#ffffff" stroke-width="1.5" /></svg>`
    : `<svg viewBox="0 0 24 24" width="${ICON_SIZE}" height="${ICON_SIZE}"><circle cx="12" cy="12" r="8" fill="#64748b" stroke="#ffffff" stroke-width="1.5" /></svg>`;

  const element = document.createElement("div");
  element.className = "vessel-icon";
  element.dataset.vesselId = vessel.id;
  element.dataset.icon = hasCourse ? "course" : "neutral";
  element.innerHTML = shape;

  return L.divIcon({
    className: "",
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
    html: element,
  });
}

/**
 * Карта района. Этот модуль загружается только в браузере: Leaflet при импорте
 * обращается к window, поэтому на сервере он не должен исполняться вовсе.
 */
export default function LeafletMap({
  vessels,
  onSelect,
  viewResetKey,
}: {
  vessels: readonly Vessel[];
  onSelect: (id: string) => void;
  /**
   * Счётчик возвратов к начальному виду. Изменился — карта возвращается к
   * INITIAL_VIEW. Число, а не флаг: флаг «вернуть вид» пришлось бы гасить
   * обратно, а по счётчику видно именно событие, а не состояние. Значение 0 на
   * первом рендере ничего не делает — вид при создании карты и так начальный.
   */
  viewResetKey: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Обработчик читается через ref: иначе новая функция на каждый рендер попала
  // бы в зависимости эффекта и карта пересоздавалась бы при каждом выборе.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Карта и маркеры переживают рендеры: карта создаётся один раз, маркеры
  // потом двигаются по id. Без этого каждый тик пересоздавал бы карту.
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const map = L.map(container, {
      center: [INITIAL_VIEW.lat, INITIAL_VIEW.lon],
      zoom: INITIAL_VIEW.zoom,
      maxBounds: L.latLngBounds(
        [AREA_BOUNDS.south, AREA_BOUNDS.west],
        [AREA_BOUNDS.north, AREA_BOUNDS.east],
      ),
    });

    L.tileLayer(TILE_LAYER.url, {
      attribution: TILE_LAYER.attribution,
    }).addTo(map);

    mapRef.current = map;

    // Клик по карте вне судов выбор не меняет, поэтому обработчика на карте
    // нет вовсе. Leaflet сам не снимает выбор — снимать нечему.

    // В режиме разработки React вызывает эффект дважды. Без снятия карты
    // второй вызов падает на «Map container is already initialized».
    return () => {
      map.remove();
      mapRef.current = null;
      // Маркеры принадлежали снятой карте: ссылки на них больше не годятся,
      // иначе следующий проход двигал бы значки удалённой карты.
      markersRef.current.clear();
    };
  }, []);

  /**
   * Положение и значок судов. Отдельный эффект: карта создаётся один раз, а
   * этот проход идёт на каждом тике. Маркеры не пересоздаются — двигается
   * существующий, иначе на карте моргали бы значки и терялся бы обработчик.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }

    const markers = markersRef.current;

    // Суда, которых в новом наборе нет, снимаются с карты. Демонстрация всегда
    // отдавала те же три судна, и до появления загрузки удалять было нечего;
    // теперь набор меняется целиком — при загрузке, ошибке и пустом ответе на
    // карте не должно остаться значков с прошлого экрана.
    //
    // Исчезновение судна из набора значит только, что в этот снимок оно не
    // попало: пятнадцать секунд — не весь эфир района. Это не «судно ушло».
    const present = new Set(vessels.map((vessel) => vessel.id));
    for (const [id, marker] of markers) {
      if (!present.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const vessel of vessels) {
      const existing = markers.get(vessel.id);

      if (existing === undefined) {
        const marker = L.marker([vessel.lat, vessel.lon], {
          icon: vesselIcon(vessel),
        }).addTo(map);

        // Обработчик ставится один раз на маркер и читает id из замыкания:
        // id судна не меняется, меняются только его координаты и курс.
        marker.on("click", () => {
          onSelectRef.current(vessel.id);
        });

        markers.set(vessel.id, marker);
        continue;
      }

      existing.setLatLng([vessel.lat, vessel.lon]);
      // Значок пересобирается целиком: вместе с поворотом он несёт
      // data-vessel-id и data-icon, и после шага они должны остаться верными.
      existing.setIcon(vesselIcon(vessel));
    }
  }, [vessels]);

  /**
   * Возврат к начальному виду. Отдельный эффект и отдельная зависимость: вид
   * трогается только когда сменился счётчик, а не при каждом новом наборе, —
   * иначе вторая загрузка сбрасывала бы карту, которую человек только что
   * подвинул.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || viewResetKey === 0) {
      return;
    }

    map.setView([INITIAL_VIEW.lat, INITIAL_VIEW.lon], INITIAL_VIEW.zoom);
  }, [viewResetKey]);

  return <div ref={containerRef} className="map" />;
}
