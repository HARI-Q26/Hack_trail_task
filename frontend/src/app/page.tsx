"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, CollegeStatusResponse, PublicOverviewResponse } from "@/lib/api";

const FALLBACK_SECTIONS = [
  {
    title: "Available Courses",
    description:
      "Official degree programmes, department codes, and seat availability from `/v1/courses`.",
  },
  {
    title: "Eligibility Requirements",
    description:
      "Minimum 12th percentage criteria and academic prerequisites verified from the KIT API.",
  },
  {
    title: "Tuition & Hostel Fees",
    description: "Official annual tuition and hostel fee breakdown from `/v1/courses`.",
  },
  {
    title: "Admissions Enquiry",
    description:
      "Apply or ask admission questions directly through our Voice Assistant (`/v1/admissions/applications`).",
  },
  {
    title: "Official Documents & Handbooks",
    description: "Student handbooks, circulars, and lesson notes hosted via `/v1/documents`.",
  },
  {
    title: "Contact & Campus Info",
    description: "Official admissions phone, email, website, and campus address from `/v1/college`.",
  },
];

export default function HomePage() {
  const [collegeStatus, setCollegeStatus] = useState<CollegeStatusResponse | null>(null);
  const [overview, setOverview] = useState<PublicOverviewResponse | null>(null);

  useEffect(() => {
    api.getCollegeStatus().then(setCollegeStatus).catch(() => setCollegeStatus(null));
    api.getPublicOverview().then(setOverview).catch(() => setOverview(null));
  }, []);

  const college = overview?.college;
  const courses = overview?.courses || [];
  const docCount =
    (overview?.remote_documents?.length || 0) || (overview?.indexed_documents?.length || 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {college?.tagline || "Official Campus AI Portal"}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {college?.name || "Knotopian Institute of Technology"}
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
              {college?.description ||
                "Welcome to our real-time voice assistant. Public visitors can explore admissions, courses, eligibility, fees, and official documents. Authenticated students and teachers can check attendance, timetables, leave/OD eligibility, and pending approvals."}
            </p>
            {college?.contact && (
              <p className="text-xs text-slate-500">
                Admissions: {college.contact.email} · {college.contact.phone} · {college.contact.address}
              </p>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/assistant"
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                Talk to Us (Voice Assistant)
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Student / Teacher Login
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs lg:w-84">
            <p className="font-semibold text-slate-800">Live KIT System Status</p>
            <div className="mt-2 space-y-2 text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span>OpenAPI Contract</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    collegeStatus?.available
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {collegeStatus ? (collegeStatus.available ? "Verified" : "Pending") : "Checking..."}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Live Sandbox Data</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    overview?.connected
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {overview ? (overview.connected ? "Connected" : "Needs Key / Offline") : "Checking..."}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>College Documents</span>
                <span className="font-semibold text-slate-800">{docCount}</span>
              </div>
              {overview?.today && (
                <div className="flex items-center justify-between gap-2">
                  <span>College Date</span>
                  <span className="font-medium text-slate-800">
                    {overview.today.date} ({overview.today.weekday_name})
                  </span>
                </div>
              )}
              {overview?.error && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                  {overview.error}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {courses.length > 0 ? (
        <section aria-labelledby="courses-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="courses-heading" className="text-lg font-semibold text-slate-900">
              Courses, Eligibility, Fees & Available Seats
            </h2>
            <span className="text-xs text-slate-500">Live from KIT `/v1/courses`</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <div
                key={course.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {course.code} · {course.department}
                  </span>
                  <h3 className="mt-2 text-sm font-semibold text-slate-900">{course.name}</h3>
                  <dl className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <dt>Min 12th %:</dt>
                      <dd className="font-medium text-slate-900">{course.min_12th_percent}%</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Annual Fee:</dt>
                      <dd className="font-medium text-slate-900">
                        ₹{course.annual_fee.toLocaleString("en-IN")}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Hostel Fee:</dt>
                      <dd className="font-medium text-slate-900">
                        ₹{course.hostel_fee.toLocaleString("en-IN")}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Seats:</dt>
                      <dd className="font-medium text-slate-900">{course.seats}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section aria-labelledby="admissions-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="admissions-heading" className="text-lg font-semibold text-slate-900">
              Admissions & Academic Information
            </h2>
            <span className="text-xs text-slate-500">
              Official figures load from verified PDFs & KIT College API only
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FALLBACK_SECTIONS.map((sec) => (
              <div
                key={sec.title}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{sec.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{sec.description}</p>
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  Set <code className="font-mono">COLLEGE_PARTICIPANT_KEY</code> to load live sandbox data.
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
