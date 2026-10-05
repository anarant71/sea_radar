"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEMO_TICK_MS, SOURCE_LABEL } from "@/config";
import { demoStart, stepDemo } from "@/demo";
import type { Screen } from "@/snapshot";
import {
  LOAD_BUTTON_TEXT,
  screenLabel,
  screenMessage,
  screenVessels,
  toScreen,
} from "@/snapshot";
import VesselCard from "@/components/VesselCard";

/**
 * Экран Sea Radar. Карта подключается с ssr: false — иначе Leaflet исполнился
 * бы при серверном рендеринге и упал на обращении к window.
 */
const LeafletMap = dynamic(() => import("@/components/LeafletMap"), {
  ssr: false,
});

export default function RadarView() {
  /**
   * Выбор хранится идентификатором, а не объектом судна: карта и карточка
   * читают судно из одного места, поэтому не могут разойтись.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Состояние демонстрации. Инициализатор — функция: иначе demoStart() вызывался
   * бы на каждом рендере, а не только на первом. Время старта здесь литеральное;
   * настоящее проставляется в эффекте ниже, уже в браузере.
   */
  const [demo, setDemo] = useState(demoStart);

  /**
   * Что показано сейчас. Одно состояние на весь экран, а не набор флагов
   * «идёт загрузка», «была ошибка», «есть данные»: последние два могли бы
   * оказаться истинными одновременно, и экран показал бы и суда, и ошибку.
   * Показан всегда результат последней попытки, и никакой другой.
   */
  const [screen, setScreen] = useState<Screen>({ kind: "idle-demo" });

  /**
   * Счётчик возвратов карты к начальному виду. Растёт только на первом непустом
   * успехе: заказчик просил показать пришедшие суда, но не хотел, чтобы карту
   * дёргало при каждой следующей загрузке.
   */
  const [viewResetKey, setViewResetKey] = useState(0);

  /** Первый непустой успех уже был — дальше вид карты не трогаем. */
  const centeredRef = useRef(false);

  // Демонстрация идёт, пока её не сменил результат загрузки. Флаг читается
  // эффектом таймера, поэтому живёт в ref: от него не должен перезапускаться
  // сам эффект.
  const demoRunningRef = useRef(true);
  demoRunningRef.current = screen.kind === "idle-demo";

  useEffect(() => {
    // Момент запуска таймера — это и есть время сообщения на стартовой точке.
    // Ставится здесь, а не в теле рендера: на сервере время другое, и разметка
    // не совпала бы при гидратации.
    setDemo(demoStart(new Date().toISOString()));

    // Один таймер на все суда: тик общий, внутри шага пересчитываются сразу
    // все. Таймера на судно нет — иначе суда разъехались бы по времени.
    const timer = setInterval(() => {
      // После нажатия кнопки демонстрация остановлена: тик становится холостым.
      // Настоящие суда этот таймер не двигает вовсе — он знает только demo.
      if (!demoRunningRef.current) {
        return;
      }

      // Время берётся в момент тика, а не заранее, и передаётся в шаг —
      // stepDemo остаётся чистой функцией без обращения к часам.
      const now = new Date().toISOString();
      setDemo((current) => stepDemo(current, now));
    }, DEMO_TICK_MS);

    // Снятие таймера при уходе со страницы и перед повторным запуском эффекта.
    // В разработке React вызывает эффект дважды — без этой строки остались бы
    // два интервала, и суда шли бы вдвое быстрее.
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Повторный клик по выбранному судну выбор не меняет. Здесь это выходит само:
  // тот же id даёт то же состояние, и React не перерисовывает карточку.
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  /**
   * Загрузка снимка. Кнопка заблокирована на всё время запроса, поэтому второй
   * одновременной загрузки быть не может, а с ней и гонки двух ответов.
   *
   * Набор прошлой попытки не сохраняется ни при ошибке, ни при пустом ответе:
   * состояние заменяется целиком, и на карте остаётся ровно результат этой
   * попытки. Показать суда прошлой загрузки рядом с сообщением об ошибке
   * значило бы выдать старые позиции за нынешние.
   */
  const handleLoad = useCallback(async () => {
    // Демонстрация убирается сразу, до ответа: суда, выбор и карточка уходят с
    // экрана в момент нажатия, а не после возврата с сервера.
    setScreen({ kind: "loading" });
    setSelectedId(null);

    try {
      const response = await fetch("/api/snapshot");
      const body: unknown = await response.json();
      const next = toScreen(body);

      setScreen(next);

      // Возврат к начальному виду — только на первом непустом успехе.
      if (
        next.kind === "loaded" &&
        next.snapshot.count > 0 &&
        !centeredRef.current
      ) {
        centeredRef.current = true;
        setViewResetKey((key) => key + 1);
      }
    } catch {
      // Ответа нет вовсе — сеть или разбор тела. Текста от сервера в этом
      // случае не существует, поэтому берётся та же фраза, что он отдаёт для
      // внутренней ошибки: на экране это одинаково «попытка не удалась».
      setScreen(toScreen(null));
    }
  }, []);

  // Суда на карте: демонстрационные, пока не было ни одной попытки, дальше —
  // только набор последней. При загрузке, ошибке и пустом ответе он пуст.
  const vessels =
    screen.kind === "idle-demo" ? demo.vessels : screenVessels(screen);

  // Карточка показывается только для судна из текущего набора. Отдельного
  // сброса карточки не нужно: набор пуст — искать не в чем, и карточки нет.
  const selected =
    vessels.find((vessel) => vessel.id === selectedId) ?? null;

  const message = screenMessage(screen);

  return (
    <div className="radar">
      <LeafletMap
        vessels={vessels}
        onSelect={handleSelect}
        viewResetKey={viewResetKey}
      />
      {/* Порядок в панели: кнопка, подпись источника, сообщение, карточка. */}
      <aside className="panel">
        <button
          type="button"
          className="load-button"
          onClick={handleLoad}
          disabled={screen.kind === "loading"}
        >
          {LOAD_BUTTON_TEXT}
        </button>
        <p className="source">{screenLabel(screen, SOURCE_LABEL)}</p>
        {message !== null && <p className="notice">{message}</p>}
        {selected !== null && <VesselCard vessel={selected} />}
      </aside>
    </div>
  );
}
