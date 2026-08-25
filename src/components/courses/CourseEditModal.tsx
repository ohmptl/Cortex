"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useCourseStore } from "@/store/courseStore";
import { calculateCategoryGrade, calculateOverallGrade } from "@/lib/utils/grades";
import type { Course, GradedItem, GradeWeight } from "@/types/course";
import { DEFAULT_COURSE_COLORS } from "@/types/course";

interface CourseEditModalProps {
  course: Course | null;
  onClose: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function CourseEditModal({ course, onClose }: CourseEditModalProps) {
  return (
    <Modal open={!!course} onClose={onClose} title="Edit course" widthClassName="max-w-2xl">
      {course && (
        // key forces a remount (fresh initial state) whenever a different course is edited
        <CourseEditForm key={course.id} course={course} />
      )}
    </Modal>
  );
}

function CourseEditForm({ course }: { course: Course }) {
  const { editCourse } = useCourseStore();

  const [code, setCode] = useState(course.code);
  const [name, setName] = useState(course.name);
  const [color, setColor] = useState(course.color);
  const [instructor, setInstructor] = useState(course.instructor ?? "");
  const [weights, setWeights] = useState<GradeWeight[]>(course.gradeWeights);
  const [items, setItems] = useState<GradedItem[]>(course.gradedItems);

  const [newItemCategory, setNewItemCategory] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemScore, setNewItemScore] = useState("");
  const [newItemTotal, setNewItemTotal] = useState("100");

  const previewCourse: Course = { ...course, gradeWeights: weights, gradedItems: items };
  const overallGrade = calculateOverallGrade(previewCourse);

  async function handleSaveDetails() {
    await editCourse(course.id, { code, name, color, instructor: instructor || null });
  }

  async function handleSaveWeights() {
    await editCourse(course.id, { gradeWeights: weights });
  }

  function addWeight() {
    setWeights([...weights, { category: "New Category", weight: 0 }]);
  }

  function updateWeight(index: number, patch: Partial<GradeWeight>) {
    setWeights(weights.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWeight(index: number) {
    setWeights(weights.filter((_, i) => i !== index));
  }

  async function addGradedItem() {
    if (!newItemCategory || !newItemName || !newItemScore) return;
    const item: GradedItem = {
      id: generateId(),
      category: newItemCategory,
      name: newItemName,
      score: Number(newItemScore),
      total: Number(newItemTotal) || 100,
    };
    const updated = [...items, item];
    setItems(updated);
    await editCourse(course.id, { gradedItems: updated });
    setNewItemName("");
    setNewItemScore("");
    setNewItemTotal("100");
  }

  async function removeGradedItem(id: string) {
    const updated = items.filter((i) => i.id !== id);
    setItems(updated);
    await editCourse(course.id, { gradedItems: updated });
  }

  return (
    <div className="flex flex-col gap-6">
        {/* Course details */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code"
              className="w-32 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="min-w-[160px] flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
            />
            <input
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              placeholder="Instructor"
              className="w-40 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
            />
          </div>
          <div className="flex items-center gap-1">
            {DEFAULT_COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full"
                style={{
                  backgroundColor: c,
                  outline: color === c ? "2px solid var(--text)" : "none",
                  outlineOffset: 2,
                }}
                aria-label={`Choose color ${c}`}
              />
            ))}
            <button
              onClick={handleSaveDetails}
              className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Save details
            </button>
          </div>
        </section>

        <hr className="border-border" />

        {/* Grade weights */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Grading scheme</h3>
            <span className="text-lg font-semibold" style={{ color }}>
              {overallGrade !== null ? `${overallGrade.toFixed(1)}%` : "N/A"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {weights.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={w.category}
                  onChange={(e) => updateWeight(i, { category: e.target.value })}
                  className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
                />
                <input
                  type="number"
                  value={w.weight}
                  onChange={(e) => updateWeight(i, { weight: Number(e.target.value) })}
                  className="w-16 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
                />
                <span className="text-xs text-text-faint">%</span>
                <span className="w-14 text-right text-xs text-text-faint">
                  {(() => {
                    const g = calculateCategoryGrade(previewCourse, w.category);
                    return g !== null ? `${g.toFixed(0)}%` : "—";
                  })()}
                </span>
                <button
                  onClick={() => removeWeight(i)}
                  className="text-text-faint hover:text-red"
                  aria-label="Remove category"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={addWeight}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text"
            >
              + Add category
            </button>
            <button
              onClick={handleSaveWeights}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Save weights
            </button>
          </div>
        </section>

        <hr className="border-border" />

        {/* Graded items */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-text">Grades</h3>
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md bg-bg px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-text">{item.name}</span>
                  <span className="ml-2 text-xs text-text-faint">{item.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">
                    {item.score}/{item.total}
                  </span>
                  <button
                    onClick={() => removeGradedItem(item.id)}
                    className="text-text-faint hover:text-red"
                    aria-label="Remove grade"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="text-xs text-text-faint">No grades yet</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={newItemCategory}
              onChange={(e) => setNewItemCategory(e.target.value)}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
            >
              <option value="">Category…</option>
              {weights.map((w) => (
                <option key={w.category} value={w.category}>
                  {w.category}
                </option>
              ))}
            </select>
            <input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Name (e.g. Quiz 1)"
              className="min-w-[120px] flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
            />
            <input
              value={newItemScore}
              onChange={(e) => setNewItemScore(e.target.value)}
              placeholder="Score"
              className="w-20 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
            />
            <span className="text-text-faint">/</span>
            <input
              value={newItemTotal}
              onChange={(e) => setNewItemTotal(e.target.value)}
              placeholder="Total"
              className="w-20 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none"
            />
            <button
              onClick={addGradedItem}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Add grade
            </button>
          </div>
        </section>
      </div>
  );
}
