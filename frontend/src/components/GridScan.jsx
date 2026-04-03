import React, { Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";

const Spline = lazy(() => import("@splinetool/react-spline"));

export default function SplineCard() {
  const navigate = useNavigate();

  return (
    <div className="w-full h-screen bg-black relative overflow-hidden text-white">
      
      {/* Background glow */}
      <div className="absolute -top-40 left-0 md:left-60 md:-top-20 w-[600px] h-[600px] bg-white opacity-10 blur-3xl rounded-full pointer-events-none"></div>

      <div className="flex h-full relative z-10">
        
        {/* Left Content */}
        <div className="flex-1 p-8 md:p-16 flex flex-col justify-center">
          
          {/* ✅ Updated Heading */}
          <h1 className="text-4xl md:text-6xl font-extrabold leading-[1.2] bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent">
  Prospecter AI
</h1>

          {/* ✅ Updated Description */}
         <p className="mt-5 text-gray-300 max-w-lg leading-[1.8] text-lg">
  Discover high-quality leads, extract business data, and automate your prospecting workflow — all in one place.
</p>
          {/* Button */}
          <div className="mt-8">
            <button
              onClick={() => navigate("/dashboard")}  // ✅ FIXED
              className="group relative inline-flex items-center justify-center px-8 py-3 rounded-lg overflow-hidden border border-white/20 bg-white text-black font-semibold transition-all duration-300 hover:scale-105 hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] active:scale-95"
            >
              
              {/* Shine effect */}
              <span className="absolute inset-0 overflow-hidden rounded-lg">
                <span className="absolute -left-full top-0 h-full w-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-all duration-700 group-hover:left-full"></span>
              </span>

              <span className="relative z-10">
                Get Started
              </span>
            </button>
          </div>

        </div>

        {/* Right Content (Spline) */}
        <div className="flex-1 relative">
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                Loading 3D...
              </div>
            }
          >
            <Spline
              scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
              className="w-full h-full"
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}