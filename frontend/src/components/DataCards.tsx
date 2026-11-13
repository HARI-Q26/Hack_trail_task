"use client";

import React from "react";

// ==========================================
// 1. ATTENDANCE CARD
// ==========================================
export interface SubjectAttendanceItem {
  subject_id?: number;
  subject_code: string;
  subject_name: string;
  classes_held: number;
  classes_attended: number;
  classes_od?: number;
  classes_absent?: number;
  percentage: number;
}

export interface AttendanceToolData {
  as_of_date?: string;
  overall_percentage: number;
  total_classes_held: number;
  total_classes_attended: number;
  subjects?: SubjectAttendanceItem[];
}

export function AttendanceCard({ data }: { data: AttendanceToolData }) {
  if (typeof data.overall_percentage !== "number") return null;

  const pct = Math.round(data.overall_percentage * 10) / 10;
  const isEligible = pct >= 75.0;
  const isBorderline = pct >= 65.0 && pct < 75.0;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-linear-to-r from-slate-900 to-slate-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500 text-xs font-bold">
            📊
          </span>
          <span className="text-xs font-semibold tracking-wide uppercase">
            Official Attendance Record
          </span>
          {data.as_of_date && (
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
              As of {data.as_of_date}
            </span>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            isEligible
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
              : isBorderline
              ? "bg-amber-500/20 text-amber-300 border border-amber-400/30"
              : "bg-rose-500/20 text-rose-300 border border-rose-400/30"
          }`}
        >
          {isEligible ? "✓ Eligible for Exams (≥75%)" : "⚠ Shortage Risk (<75%)"}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Overall Percentage Progress Bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Overall Attendance
            </span>
            <span
              className={`font-mono text-xl font-bold ${
                isEligible ? "text-emerald-600" : isBorderline ? "text-amber-600" : "text-rose-600"
              }`}
            >
              {pct}%
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                isEligible ? "bg-emerald-500" : isBorderline ? "bg-amber-500" : "bg-rose-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
            <span>Minimum threshold: 75%</span>
            <span>Target: 100%</span>
          </div>
        </div>

        {/* Classes Statistics Grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-center">
            <p className="text-[11px] font-medium text-slate-500 uppercase">Classes Held</p>
            <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
              {data.total_classes_held}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 text-center">
            <p className="text-[11px] font-medium text-emerald-700 uppercase">Attended</p>
            <p className="mt-0.5 font-mono text-base font-bold text-emerald-800">
              {data.total_classes_attended}
            </p>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-2.5 text-center">
            <p className="text-[11px] font-medium text-rose-700 uppercase">Absent</p>
            <p className="mt-0.5 font-mono text-base font-bold text-rose-800">
              {Math.max(0, data.total_classes_held - data.total_classes_attended)}
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-2.5 text-center">
            <p className="text-[11px] font-medium text-blue-700 uppercase">On-Duty</p>
            <p className="mt-0.5 font-mono text-base font-bold text-blue-800">
              {data.subjects?.reduce((acc, s) => acc + (s.classes_od || 0), 0) || 0}
            </p>
          </div>
        </div>

        {/* Per-Subject Breakdown Table */}
        {data.subjects && data.subjects.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-3.5 py-2">Subject</th>
                  <th className="px-3.5 py-2 text-center">Held</th>
                  <th className="px-3.5 py-2 text-center">Attended</th>
                  <th className="px-3.5 py-2 text-right">Percentage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.subjects.map((sub, idx) => {
                  const subPct = Math.round(sub.percentage * 10) / 10;
                  return (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      <td className="px-3.5 py-2">
                        <span className="font-mono font-semibold text-blue-700 mr-1.5">
                          {sub.subject_code}
                        </span>
                        <span className="text-slate-800">{sub.subject_name}</span>
                      </td>
                      <td className="px-3.5 py-2 text-center font-mono text-slate-600">
                        {sub.classes_held}
                      </td>
                      <td className="px-3.5 py-2 text-center font-mono font-semibold text-emerald-700">
                        {sub.classes_attended}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        <span
                          className={`font-mono font-bold ${
                            subPct >= 75 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {subPct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 2. ACADEMICS & MARKS CARD
// ==========================================
export interface AcademicToolData {
  profile?: {
    name?: string;
    login_id?: string;
    class_name?: string;
    department?: string;
    year?: number;
  };
  academics?: {
    cgpa?: number;
    standing_arrears?: number;
    placed_company?: string | null;
    placed_category?: string | null;
  };
  subjects?: Array<{
    code: string;
    name: string;
    credits?: number;
    semester?: number;
  }>;
}

export function AcademicsCard({ data }: { data: AcademicToolData }) {
  const acad = data.academics;
  if (!acad || typeof acad.cgpa !== "number") return null;

  const cgpa = acad.cgpa;
  const arrears = acad.standing_arrears ?? 0;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex items-center justify-between border-b border-slate-100 bg-linear-to-r from-blue-900 to-indigo-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-base">🎓</span>
          <div>
            <h4 className="text-xs font-bold tracking-wide uppercase">
              Academic Standing & CGPA
            </h4>
            {data.profile?.name && (
              <p className="text-[11px] text-blue-200">
                {data.profile.name} · {data.profile.class_name || "UG CSE"}
              </p>
            )}
          </div>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white border border-white/20">
          KIT Official Transcript
        </span>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* CGPA */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-center">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
            Cumulative GPA
          </p>
          <div className="mt-1 flex items-baseline justify-center gap-1">
            <span className="font-mono text-2xl font-black text-blue-900">{cgpa}</span>
            <span className="text-xs text-blue-600 font-medium">/ 10.0</span>
          </div>
          <p className="mt-1 text-[11px] text-blue-700 font-medium">
            {cgpa >= 8.0 ? "First Class with Distinction" : "First Class"}
          </p>
        </div>

        {/* Standing Arrears */}
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-center">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
            Standing Arrears
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-900">{arrears}</p>
          <p className="mt-1 text-[11px] text-emerald-700 font-medium">
            {arrears === 0 ? "All Clear Record" : `${arrears} Pending Arrears`}
          </p>
        </div>

        {/* Placement Eligibility */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Placement Status
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900">
            {acad.placed_company ? acad.placed_company : "Eligible for Drives"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {acad.placed_category ? `Category: ${acad.placed_category}` : "Open Campus Recruitment"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. COURSES & ADMISSION FEES CARD
// ==========================================
export interface CourseItemData {
  id?: number;
  code: string;
  name: string;
  department?: string;
  min_12th_percent: number;
  annual_fee: number;
  hostel_fee?: number;
  seats: number;
}

export function CourseDetailsCard({ courses }: { courses: CourseItemData[] }) {
  if (!Array.isArray(courses) || courses.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex items-center justify-between border-b border-slate-100 bg-linear-to-r from-slate-900 to-slate-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-base">🏛️</span>
          <span className="text-xs font-bold tracking-wide uppercase">
            Official Course Offerings & Fee Structure (2026-27)
          </span>
        </div>
        <span className="text-xs text-slate-300">{courses.length} Programmes</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-700">
            <tr>
              <th className="px-3.5 py-2.5">Degree Programme</th>
              <th className="px-3.5 py-2.5 text-center">Min 12th %</th>
              <th className="px-3.5 py-2.5 text-right">Annual Tuition</th>
              <th className="px-3.5 py-2.5 text-right">Hostel Fee</th>
              <th className="px-3.5 py-2.5 text-center">Seats</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {courses.map((c, idx) => (
              <tr key={idx} className="hover:bg-slate-50/70">
                <td className="px-3.5 py-2.5">
                  <span className="font-mono font-bold text-blue-700 mr-1.5">{c.code}</span>
                  <span className="text-slate-900 font-medium">{c.name}</span>
                </td>
                <td className="px-3.5 py-2.5 text-center font-semibold text-slate-700">
                  {c.min_12th_percent}%
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                  ₹{c.annual_fee.toLocaleString("en-IN")}
                </td>
                <td className="px-3.5 py-2.5 text-right font-mono text-slate-600">
                  {c.hostel_fee ? `₹${c.hostel_fee.toLocaleString("en-IN")}` : "Optional"}
                </td>
                <td className="px-3.5 py-2.5 text-center font-mono font-semibold text-emerald-700">
                  {c.seats}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
