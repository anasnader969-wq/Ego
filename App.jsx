import React, { useEffect, useState } from "react";

export default function App() {
  const [state, setState] = useState("idle");
  const [displayText, setDisplayText] = useState("");

  /*
    UI states:

    idle      = الشاشة سوداء بالكامل
    listening = المساعد يستمع
    speaking  = المساعد يتكلم
    text      = عرض محتوى مكتوب
  */

  useEffect(() => {
    // Placeholder for the real voice system.
    // The real Voice/AI system will control this state later.
  }, []);

  const isActive = state !== "idle";

  const intensity =
    state === "speaking"
      ? 1
      : state === "listening"
      ? 0.8
      : state === "text"
      ? 0.55
      : 0;

  return (
    <>
      <style>{`
        * {
          box-sizing: border-box;
        }

        html,
        body,
        #root {
          margin: 0;
          width: 100%;
          height: 100%;
          background: #000;
          overflow: hidden;
        }

        body {
          font-family:
            Inter,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .app {
          width: 100vw;
          height: 100vh;

          display: flex;
          align-items: center;
          justify-content: center;

          background: #000;

          overflow: hidden;
          position: relative;
        }

        /*
          Main floating surface
        */

        .voice-surface {
          position: relative;

          width: min(88vw, 760px);
          min-height: 210px;

          padding: 52px;

          border-radius: 38px;

          display: flex;
          align-items: center;
          justify-content: center;

          opacity: ${isActive ? 1 : 0};

          transform:
            scale(${isActive ? 1 : 0.94});

          transition:
            opacity 700ms ease,
            transform 700ms cubic-bezier(.22,1,.36,1);

          background:
            linear-gradient(
              145deg,
              rgba(0, 0, 0, 0.12),
              rgba(0, 0, 0, 0.02)
            );

          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);

          box-shadow:
            0 0 ${55 * intensity}px
            rgba(0, 191, 255, ${0.20 * intensity}),

            0 0 ${90 * intensity}px
            rgba(125, 0, 255, ${0.18 * intensity}),

            inset 0 0 40px
            rgba(255, 255, 255, ${0.025 * intensity});
        }

        /*
          Electric Blue → Chili Violet border
        */

        .voice-surface::before {
          content: "";

          position: absolute;
          inset: -1px;

          border-radius: inherit;

          padding: 1.5px;

          background:
            linear-gradient(
              115deg,
              rgba(0, 191, 255, ${0.9 * intensity}),
              rgba(112, 0, 255, ${0.95 * intensity}),
              rgba(0, 191, 255, ${0.8 * intensity})
            );

          -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);

          -webkit-mask-composite: xor;
          mask-composite: exclude;

          opacity: ${isActive ? 1 : 0};

          filter:
            blur(${state === "speaking" ? 0.3 : 0.8}px);

          animation:
            borderFlow
            ${state === "speaking" ? "2.2s" : "5s"}
            linear
            infinite;

          pointer-events: none;
        }

        /*
          Glass reflection
        */

        .voice-surface::after {
          content: "";

          position: absolute;

          width: 65%;
          height: 65%;

          left: 50%;
          top: 50%;

          transform:
            translate(-50%, -50%)
            scale(${state === "speaking" ? 1.12 : 0.9});

          border-radius: 50%;

          background:
            radial-gradient(
              circle,

              rgba(
                255,
                255,
                255,
                ${0.07 * intensity}
              ) 0%,rgba(
                0,
                191,
                255,
                ${0.12 * intensity}
              ) 25%,

              rgba(
                112,
                0,
                255,
                ${0.10 * intensity}
              ) 50%,

              transparent 75%
            );

          filter: blur(32px);

          animation:
            glassPulse
            ${state === "speaking" ? "1.7s" : "3.5s"}
            ease-in-out
            infinite;

          pointer-events: none;
        }

        /*
          Center voice core
        */

        .voice-core {
          position: absolute;

          width:
            ${state === "speaking"
              ? "120px"
              : state === "listening"
              ? "95px"
              : "70px"};

          height:
            ${state === "speaking"
              ? "120px"
              : state === "listening"
              ? "95px"
              : "70px"};

          border-radius: 50%;

          background:
            radial-gradient(
              circle at 35% 30%,

              rgba(255,255,255,${0.13 * intensity}),

              rgba(0,191,255,${0.22 * intensity}) 25%,

              rgba(112,0,255,${0.18 * intensity}) 55%,

              transparent 75%
            );

          filter:
            blur(${state === "speaking" ? 13 : 18}px);

          opacity: ${isActive ? 1 : 0};

          animation:
            coreBreathing
            ${state === "speaking" ? "1.2s" : "2.5s"}
            ease-in-out
            infinite;

          z-index: 1;

          pointer-events: none;
        }

        /*
          Text appears only when requested.
        */

        .voice-content {
          position: relative;

          z-index: 5;

          width: 100%;
          max-width: 650px;

          text-align: center;

          opacity:
            ${state === "text" || state === "speaking"
              ? 1
              : 0};

          transform:
            translateY(
              ${state === "text" || state === "speaking"
                ? "0"
                : "8px"}
            );

          transition:
            opacity 450ms ease,
            transform 450ms ease;
        }

        .voice-text {
          margin: 0;

          color:
            rgba(
              255,
              255,
              255,
              ${state === "speaking" ? 1 : 0.86}
            );

          font-size:
            clamp(20px, 3vw, 34px);

          line-height: 1.5;

          font-weight: 400;

          letter-spacing: -0.015em;

          text-shadow:
            0 0 18px
            rgba(0,191,255,${0.18 * intensity}),

            0 0 35px
            rgba(112,0,255,${0.16 * intensity});

          animation:
            textBreathing
            ${state === "speaking" ? "1.3s" : "2.8s"}
            ease-in-out
            infinite;
        }

        /*
          Glass particles / water-like reflections
        */

        .reflection {
          position: absolute;

          width: 8px;
          height: 8px;

          border-radius: 50%;

          background:
            radial-gradient(
              circle,
              rgba(255,255,255,${0.18 * intensity}),
              transparent 70%
            );

          filter: blur(1px);

          opacity: ${isActive ? 1 : 0};

          animation:
            reflectionFloat
            4s
            ease-in-out
            infinite;

          pointer-events: none;
        }

        .reflection.one {
          top: 22%;
          left: 18%;
        }

        .reflection.two {
          bottom: 24%;
          right: 20%;

          animation-delay: -1.5s;
        }

        .reflection.three {
          top: 30%;
          right: 28%;

          animation-delay: -2.5s;
        }

        /*
          Animations
        */

        @keyframes borderFlow {
          0% {
            filter:
              hue-rotate(0deg)
              brightness(0.75);
          }50% {
            filter:
              hue-rotate(18deg)
              brightness(1.55);
          }

          100% {
            filter:
              hue-rotate(0deg)
              brightness(0.75);
          }
        }

        @keyframes glassPulse {
          0%,
          100% {
            opacity: 0.45;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes coreBreathing {
          0%,
          100% {
            transform: scale(0.9);
          }

          50% {
            transform: scale(1.1);
          }
        }

        @keyframes textBreathing {
          0%,
          100% {
            opacity: 0.78;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes reflectionFloat {
          0%,
          100% {
            transform:
              translate(0, 0)
              scale(0.8);
          }

          50% {
            transform:
              translate(12px, -10px)
              scale(1.2);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .voice-surface::before,
          .voice-surface::after,
          .voice-core,
          .voice-text,
          .reflection {
            animation: none;
          }
        }
      `}</style>

      <main className="app">

        <div className="voice-surface">

          <div className="voice-core" />

          <div className="reflection one" />
          <div className="reflection two" />
          <div className="reflection three" />

          <div className="voice-content">
            {displayText && (
              <p className="voice-text">
                {displayText}
              </p>
            )}
          </div>

        </div>

      </main>
    </>
  );
}
