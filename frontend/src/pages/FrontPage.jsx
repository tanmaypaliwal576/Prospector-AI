import React from "react";
import { useNavigate } from "react-router-dom"; // ✅ add this
import { GridScan } from "../components/GridScan";

const FrontPage = () => {
  const navigate = useNavigate(); // ✅ init

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* 🔥 BACKGROUND */}
      <div className="absolute inset-0">
        <GridScan
          sensitivity={0.55}
          lineThickness={1}
          linesColor="#392e4e"
          gridScale={0.1}
          scanColor="#b419a0"
          scanOpacity={0.4}
          enablePost
          bloomIntensity={0.6}
          chromaticAberration={0.002}
          noiseIntensity={0.01}
        />
      </div>

      {/* 🔥 OVERLAY CONTENT */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
        {/* Tag */}
        <div className="mb-4 px-4 py-1 rounded-full bg-white/10 border border-white/20 text-sm text-white">
          Prospector AI - Your Ultimate Prospecting Assistant
        </div>

        {/* Heading */}
        <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight">
          Hold on, Ready to <br />
          Start Scraping?
        </h1>

        {/* Buttons */}
        <div className="mt-6 flex gap-4">
          {/* ✅ UPDATED BUTTON */}
          <button
            onClick={() => {
              setTimeout(() => navigate("/dashboard"), 200);
            }}
            className="px-6 py-3 rounded-full bg-white text-black font-medium hover:scale-105 transition"
          >
            Get Started
          </button>

          <button className="px-6 py-3 rounded-full bg-transparent text-white font-medium hover:scale-105 transition border border-white/20"
          onClick={() => {
              setTimeout(() => navigate("/dashboard"), 200);
            }}
            >
            See It in Action
          </button>
        </div>
      </div>
    </div>
  );
};

export default FrontPage;
