import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { supabase } from "../supabase";
import { GoogleGenAI, Type } from "@google/genai";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

// Initialize the Gemini AI SDK using your environment variable
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

function ViewPath() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathId = location.state?.pathId;

  const quizTopRef = useRef(null);

  const [user, setUser] = useState(null);
  const [path, setPath] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [completedLessons, setCompletedLessons] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- HEART SYSTEM STATE ---
  const [hearts, setHearts] = useState(5);
  const [showHeartModal, setShowHeartModal] = useState(false);
  const [nextHeartTime, setNextHeartTime] = useState("");

  // --- STUDENT NAVIGATION ENGINE ---
  const [viewMode, setViewMode] = useState("list");
  const [activeLessonId, setActiveLessonId] = useState(null);
  const [activeQuizId, setActiveQuizId] = useState(null);

  // --- FILE PREVIEW MODAL STATE ---
  const [previewFile, setPreviewFile] = useState(null);

  // --- ADMIN/PROFESSOR/ADMIN ASSISTANT FORM STATES ---
  const [lessonForm, setLessonForm] = useState({ title: "", description: "", links: [], files: [] });
  const [linkInput, setLinkInput] = useState({ title: "", url: "" });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedLessonForQuiz, setSelectedLessonForQuiz] = useState("");
  const [quizForm, setQuizForm] = useState([
    { question: "", choices: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }] }
  ]);

  // --- AI QUIZ GENERATOR STATES ---
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiInputMode, setAiInputMode] = useState("lesson"); // "lesson" or "paste"
  const [aiLessonTarget, setAiLessonTarget] = useState("");
  const [aiPastedText, setAiPastedText] = useState("");
  const [aiAttachedFiles, setAiAttachedFiles] = useState([]); // files attached specifically for AI generation
  const [aiDifficulty, setAiDifficulty] = useState("Medium");
  const [aiNumQuestions, setAiNumQuestions] = useState(5);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  // --- AI GENERATION SUCCESS MODAL STATE ---
  const [aiSuccessModalOpen, setAiSuccessModalOpen] = useState(false);

  // --- MODAL STATES ---
  const [editLessonTarget, setEditLessonTarget] = useState(null);
  const [editQuizTarget, setEditQuizTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // --- STUDENT DATA STATE ---
  const [studentAnswers, setStudentAnswers] = useState({});

  const getCollectionName = (type) => (type === "quiz" ? "quizzes" : "lessons");

  const getLinkIcon = (url) => {
    try {
      const domain = new URL(url).hostname;
      return (
        <img 
          src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`} 
          alt="icon" 
          style={{ width: '20px', height: '20px', objectFit: 'contain', borderRadius: '4px' }} 
        />
      );
    } catch (e) {
      return <span>🔗</span>;
    }
  };

  const getFileIcon = (fileType, fileUrl = "") => {
    if (fileType?.includes("image") || fileUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i)) return "🖼️";
    if (fileType?.includes("pdf") || fileUrl.endsWith(".pdf")) return "📄";
    if (fileType?.includes("video") || fileUrl.match(/\.(mp4|webm|ogg)$/i)) return "🎥";
    if (fileType?.includes("sheet") || fileType?.includes("excel") || fileUrl.match(/\.(xls|xlsx|csv)$/i)) return "📊";
    if (fileType?.includes("presentation") || fileUrl.match(/\.(ppt|pptx)$/i)) return "📊";
    return "📁";
  };

  const getSafeHostname = (url) => {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "External Link";
    }
  };

  // --- FILE VIEWER CONTENT HELPER ---
  const renderFileViewerContent = (file) => {
    if (!file) return null;
    const isDoc = file.ext === "doc" || file.ext === "docx" || file.ext === "ppt" || file.ext === "pptx" || 
                  file.name?.match(/\.(doc|docx|ppt|pptx)$/i);
    
    if (file.type?.startsWith("video/") || file.url?.match(/\.(mp4|webm|ogg)$/i)) {
      return (
        <video controls className="w-100 rounded-3" style={{ maxHeight: "75vh" }}>
          <source src={file.url} type={file.type} />
        </video>
      );
    }

    if (file.type?.startsWith("image/") || file.url?.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
      return (
        <div className="text-center">
          <img src={file.url} alt={file.name} className="img-fluid rounded-3" style={{ maxHeight: "75vh" }} />
        </div>
      );
    }

    if (isDoc) {
      const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`;
      return (
        <iframe 
          src={googleViewerUrl} 
          title={file.name} 
          className="w-100 border-0 rounded-3" 
          style={{ height: "75vh" }}
        />
      );
    }

    return (
      <iframe 
        src={file.url} 
        title={file.name} 
        className="w-100 border-0 rounded-3" 
        style={{ height: "75vh" }}
      />
    );
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        navigate("/login");
      } else {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const userData = userDoc.exists()
          ? { uid: currentUser.uid, ...userDoc.data() }
          : { uid: currentUser.uid, role: "student", fullname: "Student" };
        setUser(userData);
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (hearts >= 5 || !user || !pathId) {
      setNextHeartTime("");
      return;
    }

    const interval = setInterval(async () => {
      const userPathRef = doc(db, "users", user.uid, "userPaths", pathId);
      const userPathDoc = await getDoc(userPathRef);

      if (userPathDoc.exists()) {
        const data = userPathDoc.data();
        const lastLoss = data.lastHeartLoss?.toDate();
        if (lastLoss) {
          const now = new Date();
          const nextHeartDate = new Date(lastLoss.getTime() + (3 * 60 * 60 * 1000));
          const diff = nextHeartDate - now;

          if (diff <= 0) {
            fetchData();
          } else {
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            setNextHeartTime(`${h}h ${m}m ${s}s`);
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [hearts, user, pathId]);

  const fetchData = async () => {
    if (!pathId) return navigate("/learningpaths");
    try {
      const pathDoc = await getDoc(doc(db, "content", pathId));
      if (!pathDoc.exists()) return navigate("/learningpaths");
      setPath({ id: pathDoc.id, ...pathDoc.data() });

      const lessonsSnap = await getDocs(collection(db, "content", pathId, "lessons"));
      const sortedLessons = lessonsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setLessons(sortedLessons);

      const quizzesSnap = await getDocs(collection(db, "content", pathId, "quizzes"));
      const sortedQuizzes = quizzesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setQuizzes(sortedQuizzes);

      if (user?.uid) {
        const userPathRef = doc(db, "users", user.uid, "userPaths", pathId);
        const userPathDoc = await getDoc(userPathRef);

        if (userPathDoc.exists()) {
          const data = userPathDoc.data();
          setCompletedLessons(data.completedLessons || []);
          setStudentAnswers(data.completedQuizzes || data.studentAnswers || {});

          let currentHearts = data.hearts !== undefined ? data.hearts : 5;
          const lastLoss = data.lastHeartLoss?.toDate();

          if (currentHearts < 5 && lastLoss) {
            const now = new Date();
            const msPassed = now - lastLoss;
            const hoursPassed = Math.floor(msPassed / (1000 * 60 * 60));
            const heartsToRestore = Math.floor(hoursPassed / 3);

            if (heartsToRestore > 0) {
              currentHearts = Math.min(5, currentHearts + heartsToRestore);
              await updateDoc(userPathRef, {
                hearts: currentHearts,
                lastHeartLoss: currentHearts === 5 ? null : new Date(lastLoss.getTime() + (heartsToRestore * 3 * 60 * 60 * 1000))
              });
            }
          }
          setHearts(currentHearts);
        } else {
          await setDoc(userPathRef, { hearts: 5, completedLessons: [], completedQuizzes: {}, studentAnswers: {} });
          setHearts(5);
        }
      }
    } catch (err) {
      console.error("Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && pathId) fetchData();
  }, [pathId, user]);

  // --- SUPABASE STORAGE FILE UPLOADER HANDLER ---
  const handleFileUpload = async (selectedFiles, isEditMode = false) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setUploadingFile(true);

    try {
      const uploadedFiles = [];

      for (const file of selectedFiles) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${pathId}/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("learning_paths")
          .upload(filePath, file);

        if (uploadError) {
          console.error("Supabase Upload Error:", uploadError);
          alert(`Failed to upload ${file.name}`);
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from("learning_paths")
          .getPublicUrl(filePath);

        uploadedFiles.push({
          name: file.name,
          url: publicUrlData.publicUrl,
          path: filePath,
          type: file.type,
          ext: fileExt,
          size: (file.size / 1024 / 1024).toFixed(2) + " MB"
        });
      }

      if (isEditMode) {
        setEditLessonTarget((prev) => ({
          ...prev,
          files: [...(prev.files || []), ...uploadedFiles]
        }));
      } else {
        setLessonForm((prev) => ({
          ...prev,
          files: [...(prev.files || []), ...uploadedFiles]
        }));
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading file to Supabase Storage.");
    } finally {
      setUploadingFile(false);
    }
  };

  // --- HELPER TO CONVERT URL TO BASE64 FOR GEMINI MULTIMODAL ---
  const fileToGenerativePart = async (fileUrl, mimeType) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Data = reader.result.split(",")[1];
          resolve({
            inlineData: {
              data: base64Data,
              mimeType: mimeType || "application/octet-stream"
            },
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error("Error converting file for AI:", e);
      return null;
    }
  };

  const addLinkToForm = () => {
    if (!linkInput.title || !linkInput.url) return alert("Fill link title and URL");
    setLessonForm({ ...lessonForm, links: [...(lessonForm.links || []), linkInput] });
    setLinkInput({ title: "", url: "" });
  };

  const removeLinkFromForm = (idx) => {
    setLessonForm({ ...lessonForm, links: lessonForm.links.filter((_, i) => i !== idx) });
  };

  const removeFileFromForm = async (idx, isEditMode = false) => {
    const targetArray = isEditMode ? editLessonTarget.files : lessonForm.files;
    const fileToRemove = targetArray[idx];

    if (fileToRemove?.path) {
      try {
        await supabase.storage.from("learning_paths").remove([fileToRemove.path]);
      } catch (err) {
        console.error("Failed to delete file from Supabase Storage:", err);
      }
    }

    if (isEditMode) {
      setEditLessonTarget({
        ...editLessonTarget,
        files: editLessonTarget.files.filter((_, i) => i !== idx)
      });
    } else {
      setLessonForm({
        ...lessonForm,
        files: lessonForm.files.filter((_, i) => i !== idx)
      });
    }
  };

  const addQuestion = () => {
    setQuizForm([...quizForm, { question: "", choices: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }] }]);
  };
  const removeQuestion = (qIndex) => {
    setQuizForm(quizForm.filter((_, i) => i !== qIndex));
  };
  const addChoice = (qIndex) => {
    const newForm = [...quizForm];
    newForm[qIndex].choices.push({ text: "", isCorrect: false });
    setQuizForm(newForm);
  };
  const removeChoice = (qIndex, cIndex) => {
    const newForm = [...quizForm];
    newForm[qIndex].choices = newForm[qIndex].choices.filter((_, i) => i !== cIndex);
    setQuizForm(newForm);
  };
  const handleQuizFieldChange = (qIndex, field, value) => {
    const newForm = [...quizForm];
    newForm[qIndex][field] = value;
    setQuizForm(newForm);
  };
  const handleChoiceFieldChange = (qIndex, cIndex, value) => {
    const newForm = [...quizForm];
    newForm[qIndex].choices[cIndex].text = value;
    setQuizForm(newForm);
  };
  const handleSetCorrect = (qIndex, cIndex) => {
    const newForm = [...quizForm];
    newForm[qIndex].choices.forEach((c, i) => (c.isCorrect = i === cIndex));
    setQuizForm(newForm);
  };

  const handleAddLesson = async (e) => {
    e.preventDefault();
    if (!lessonForm.title) return alert("Title required");
    await addDoc(collection(db, "content", pathId, "lessons"), {
      title: lessonForm.title,
      description: lessonForm.description,
      links: lessonForm.links || [],
      files: lessonForm.files || [],
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    setLessonForm({ title: "", description: "", links: [], files: [] });
    fetchData();
  };

  const handleAddQuiz = async () => {
    if (!selectedLessonForQuiz) return alert("Select a lesson first!");
    await addDoc(collection(db, "content", pathId, "quizzes"), {
      lessonId: selectedLessonForQuiz,
      title: `Quiz: ${lessons.find(l => l.id === selectedLessonForQuiz)?.title}`,
      questions: quizForm,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    setQuizForm([{ question: "", choices: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }] }]);
    setSelectedLessonForQuiz("");
    fetchData();
  };

  // --- AI GENERATION HANDLER WITH AUTO-RETRY & MULTIMODAL SUPPORT ---
  const handleGenerateAiQuiz = async () => {
    let promptContent = "";
    let targetLessonTitle = "Custom Content Quiz";
    let targetLessonIdForQuiz = aiLessonTarget;
    let fileParts = [];

    if (aiInputMode === "lesson") {
      if (!aiLessonTarget) return alert("Please select a lesson for the AI to read!");
      const targetLesson = lessons.find(l => l.id === aiLessonTarget);
      if (!targetLesson) return alert("Lesson not found.");
      targetLessonTitle = targetLesson.title;
      promptContent = `Generate a ${aiDifficulty} quiz with ${aiNumQuestions} questions based on this lesson:\n\nTitle: ${targetLesson.title}\nContent: ${targetLesson.description}`;
      
      // If the selected lesson also has attached files, process them for AI analysis
      if (targetLesson.files && targetLesson.files.length > 0) {
        for (const f of targetLesson.files) {
          const part = await fileToGenerativePart(f.url, f.type);
          if (part) fileParts.push(part);
        }
      }
    } else {
      if (!aiPastedText.trim() && aiAttachedFiles.length === 0) {
        return alert("Please paste some lesson text or attach an image/PDF for the AI to analyze!");
      }
      promptContent = `Generate a ${aiDifficulty} quiz with ${aiNumQuestions} questions based on the provided text and/or attached files:\n\nContent:\n${aiPastedText}`;
      
      for (const f of aiAttachedFiles) {
        const part = await fileToGenerativePart(f.url, f.type);
        if (part) fileParts.push(part);
      }
    }

    setIsGeneratingAi(true);

    const generateWithRetry = async (retries = 3, delay = 5000) => {
      try {
        const contentsArray = [promptContent, ...fileParts];
        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: contentsArray,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      choices: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            text: { type: Type.STRING },
                            isCorrect: { type: Type.BOOLEAN }
                          },
                          required: ["text", "isCorrect"]
                        }
                      }
                    },
                    required: ["question", "choices"]
                  }
                }
              },
              required: ["questions"]
            }
          }
        });
        return response;
      } catch (err) {
        if (err.status === 429 && retries > 0) {
          console.warn(`Rate limited (429). Retrying in ${delay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return generateWithRetry(retries - 1, delay * 2);
        }
        throw err;
      }
    };

    try {
      const response = await generateWithRetry();
      const data = JSON.parse(response.text);
      
      if (data.questions) {
        await addDoc(collection(db, "content", pathId, "quizzes"), {
          lessonId: targetLessonIdForQuiz || null,
          title: `AI Quiz (${aiDifficulty}): ${targetLessonTitle}`,
          questions: data.questions, 
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });

        setAiModalOpen(false);
        setAiLessonTarget("");
        setAiPastedText("");
        setAiAttachedFiles([]);
        fetchData();
        setAiSuccessModalOpen(true);
      } else {
        alert("Failed to parse AI response.");
      }
    } catch (err) {
      console.error("AI Generation Error:", err);
      if (err.status === 429) {
        alert("You have hit the free tier rate limit. Please wait about a minute before trying again.");
      } else {
        alert("Error generating quiz with AI. Check console for details.");
      }
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleUpdateLesson = async () => {
    await updateDoc(doc(db, "content", pathId, "lessons", editLessonTarget.id), {
      title: editLessonTarget.title,
      description: editLessonTarget.description,
      links: editLessonTarget.links || [],
      files: editLessonTarget.files || []
    });
    setEditLessonTarget(null);
    fetchData();
  };

  const handleUpdateQuiz = async () => {
    try {
      await updateDoc(doc(db, "content", pathId, "quizzes", editQuizTarget.id), {
        title: editQuizTarget.title,
        questions: editQuizTarget.questions
      });
      setEditQuizTarget(null);
      fetchData();
    } catch (error) {
      console.error("Update Quiz Error:", error);
    }
  };

  const confirmDelete = async () => {
    try {
      if (deleteTarget.type === "lesson") {
        const lessonRef = doc(db, "content", pathId, "lessons", deleteTarget.id);
        const lessonSnap = await getDoc(lessonRef);

        if (lessonSnap.exists()) {
          const lessonData = lessonSnap.data();
          const files = lessonData.files || [];

          for (const file of files) {
            if (file.path) {
              const { error: storageError } = await supabase.storage
                .from("learning_paths")
                .remove([file.path]);

              if (storageError) {
                console.error(`Failed to delete file from storage: ${file.path}`, storageError);
              }
            }
          }
        }

        const quizzesSnap = await getDocs(collection(db, "content", pathId, "quizzes"));
        const attachedQuiz = quizzesSnap.docs.find(q => q.data().lessonId === deleteTarget.id);
        if (attachedQuiz) {
          await deleteDoc(doc(db, "content", pathId, "quizzes", attachedQuiz.id));
        }
      }

      await deleteDoc(doc(db, "content", pathId, getCollectionName(deleteTarget.type), deleteTarget.id));
    } catch (err) {
      console.error("Error executing deletion workflow:", err);
    }

    setDeleteTarget(null);
    fetchData();
  };

  const handleCompleteLesson = async (lessonId) => {
    const userPathRef = doc(db, "users", user.uid, "userPaths", pathId);
    if (!completedLessons.includes(lessonId)) {
      const updated = [...completedLessons, lessonId];
      await setDoc(userPathRef, { completedLessons: updated, updatedAt: serverTimestamp() }, { merge: true });
      setCompletedLessons(updated);
    }
  };

  const isQuizPerfect = (quiz) => {
    if (!quiz) return false;
    const answers = studentAnswers[quiz.id];
    if (!answers || Object.keys(answers).length < quiz.questions.length) return false;
    return quiz.questions.every((q, i) => q.choices[answers[i]]?.isCorrect === true);
  };

  const handleAnswer = async (quizId, qIdx, cIdx, quiz) => {
    if (isQuizPerfect(quiz)) return;
    const userPathRef = doc(db, "users", user.uid, "userPaths", pathId);
    const newAnswers = { ...studentAnswers, [quizId]: { ...studentAnswers[quizId], [qIdx]: cIdx } };
    
    await setDoc(userPathRef, { 
      completedQuizzes: newAnswers, 
      studentAnswers: newAnswers 
    }, { merge: true });
    
    setStudentAnswers(newAnswers);
  };

  const handleRedoQuiz = async (quizId) => {
    const currentQuiz = quizzes.find(q => q.id === quizId);
    if (isQuizPerfect(currentQuiz)) {
      alert("You have already perfected this quiz! No need to retake.");
      return;
    }
    if (hearts <= 0) {
      alert("You have no hearts left! Please wait for them to regenerate.");
      return;
    }

    if (quizTopRef.current) {
      quizTopRef.current.scrollIntoView({ behavior: 'smooth' });
    }

    const userPathRef = doc(db, "users", user.uid, "userPaths", pathId);
    const newHeartCount = hearts - 1;
    const newAnswers = { ...studentAnswers };
    delete newAnswers[quizId];
    setHearts(newHeartCount);
    setStudentAnswers(newAnswers);

    const updateData = {
      completedQuizzes: newAnswers,
      studentAnswers: newAnswers,
      hearts: newHeartCount
    };
    if (hearts === 5) {
      updateData.lastHeartLoss = new Date();
    }
    try {
      await updateDoc(userPathRef, updateData);
    } catch (error) {
      console.error("Redo error:", error);
      fetchData();
    }
  };

  const initialActiveQuiz = quizzes.find((q) => q.id === activeQuizId);
  const isQuizOngoing = 
    viewMode === "quiz" && 
    initialActiveQuiz && 
    Object.keys(studentAnswers[initialActiveQuiz.id] || {}).length < (initialActiveQuiz.questions?.length || 0);

  useEffect(() => {
    const globalNavbar = document.getElementById("main-global-navbar");

    if (isQuizOngoing) {
      if (globalNavbar) globalNavbar.style.display = "none";
    } else {
      if (globalNavbar) globalNavbar.style.display = "block";
    }

    const handleBeforeUnload = (e) => {
      if (isQuizOngoing) {
        e.preventDefault();
        e.returnValue = "Warning: Leaving this page will drop your progress!";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (globalNavbar) globalNavbar.style.display = "block";
    };
  }, [isQuizOngoing]);

  if (loading || !path) return <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>;

  const activeLesson = lessons.find((l) => l.id === activeLessonId);
  const activeQuiz = quizzes.find((q) => q.id === activeQuizId);
  const progressPercent = lessons.length ? Math.round((completedLessons.length / lessons.length) * 100) : 0;
  
  const canManageCurriculum = user?.role === "admin" || user?.role === "professor" || user?.role === "admin assistant";

  return (
    <div className="bg-light min-vh-100 pb-5">
      <style>
        {`
          .choice-card-btn {
            transition: all 0.2s ease-in-out;
            border: 2px solid #dee2e6 !important;
            color: #212529 !important;
            background-color: #ffffff !important;
          }
          .choice-card-btn:hover:not(:disabled) {
            box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15) !important;
            transform: translateY(-2px);
          }
          .choice-card-btn.answer-correct {
            background-color: #198754 !important;
            color: white !important;
            border-color: #198754 !important;
          }
          .choice-card-btn.answer-incorrect {
            background-color: #dc3545 !important;
            color: white !important;
            border-color: #dc3545 !important;
          }
          .heart-main { color: #ff4b2b; font-size: 1.2rem; cursor: pointer; }
          .heart-container:hover { background-color: #fff5f5 !important; }
          .resource-link {
            transition: all 0.2s;
            text-decoration: none;
            display: flex;
            align-items: center;
            padding: 10px 14px;
            background: #f8f9fa;
            border-radius: 10px;
            border: 1px solid #dee2e6;
            margin-bottom: 5px;
            cursor: pointer;
          }
          .resource-link:hover {
            background: #e9ecef;
            border-color: #0d6efd;
            transform: translateY(-2px);
            box-shadow: 0 0.25rem 0.5rem rgba(0,0,0,0.05);
          }
        `}
      </style>

      {/* HEADER SECTION */}
      {!isQuizOngoing && (
        <section className="bg-white border-bottom py-4 mb-4 shadow-sm">
          <div className="container">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <button
                className="btn btn-sm btn-outline-secondary rounded-pill"
                onClick={() => viewMode === "list" ? navigate(-1) : setViewMode("list")}
              >
                ← {viewMode === "list" ? "Back to Paths" : "Back to Course Menu"}
              </button>

              {user?.role === "student" && (
                <div
                  className="bg-white px-3 py-1 rounded-pill border d-flex align-items-center shadow-sm heart-container"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setShowHeartModal(true)}
                >
                  <span className="heart-main me-2">❤️</span>
                  <span className="fw-bold text-dark" style={{ fontSize: '1.1rem' }}>
                    {hearts}
                  </span>
                  {hearts < 5 && <span className="ms-2 badge bg-light text-muted border" style={{ fontSize: '10px' }}>Regenerating...</span>}
                </div>
              )}
            </div>

            {viewMode === "list" && (
              <div className="d-flex justify-content-between align-items-end">
                <div>
                  <span className="badge bg-primary mb-2 text-uppercase">
                    {canManageCurriculum ? `${user?.role === 'admin' ? 'Admin' : user?.role === 'admin assistant' ? 'Admin Assistant' : 'Professor'} Path Management` : 'Learning Path'}
                  </span>
                  <h1 className="fw-bolder mb-1">{path.title}</h1>
                  <p className="text-muted mb-0">{path.description}</p>
                </div>
                {user?.role === "student" && (
                  <div className="text-end" style={{ width: "220px" }}>
                    <div className="d-flex justify-content-between small fw-bold mb-1">
                      <span>PATH PROGRESS</span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="progress" style={{ height: "10px" }}>
                      <div className="progress-bar bg-success progress-bar-striped progress-bar-animated" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {isQuizOngoing && <div className="py-4" />}

      <div className="container">
        {canManageCurriculum ? (
          /* --- ADMIN, PROFESSOR & ADMIN ASSISTANT SECTION --- */
          <div className="row g-4">
            <div className="col-lg-5">
              <div className="card border-0 shadow-sm p-4 mb-4 rounded-4">
                <h5 className="fw-bold text-primary mb-3">Add New Lesson</h5>
                <input 
                  className="form-control mb-2" 
                  placeholder="Lesson Title" 
                  value={lessonForm.title} 
                  onChange={e => setLessonForm({ ...lessonForm, title: e.target.value })} 
                />
                <textarea 
                  className="form-control mb-3" 
                  rows="3" 
                  placeholder="Lesson Content..." 
                  value={lessonForm.description} 
                  onChange={e => setLessonForm({ ...lessonForm, description: e.target.value })} 
                />

                <div className="bg-light p-3 rounded-3 mb-3 border">
                  <label className="small fw-bold mb-2">ATTACH DOCUMENTS / IMAGES / MEDIA</label>
                  <input 
                    type="file" 
                    multiple
                    className="form-control form-control-sm mb-2" 
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,video/*"
                    onChange={(e) => handleFileUpload(e.target.files, false)}
                    disabled={uploadingFile}
                  />
                  {uploadingFile && <div className="text-muted small mb-2">Uploading attachments...</div>}
                  
                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {lessonForm.files?.map((file, i) => (
                      <span key={i} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-1 shadow-sm" style={{ cursor: 'pointer' }} onClick={() => setPreviewFile(file)}>
                        {getFileIcon(file.type, file.url)} <span className="text-truncate" style={{ maxWidth: "120px" }}>{file.name}</span>
                        <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={(e) => { e.stopPropagation(); removeFileFromForm(i, false); }}></button>
                      </span>
                    ))}
                  </div>

                  <hr className="my-2" />

                  <label className="small fw-bold mb-2">ATTACH EXTERNAL LINKS</label>
                  <div className="input-group input-group-sm mb-2">
                    <input className="form-control" placeholder="Link Title (e.g. Tutorial)" value={linkInput.title} onChange={e => setLinkInput({ ...linkInput, title: e.target.value })} />
                    <input className="form-control" placeholder="URL" value={linkInput.url} onChange={e => setLinkInput({ ...linkInput, url: e.target.value })} />
                    <button className="btn btn-dark" onClick={addLinkToForm}>Add</button>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    {lessonForm.links?.map((link, i) => (
                      <span key={i} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-2">
                        {getLinkIcon(link.url)} {link.title}
                        <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={() => removeLinkFromForm(i)}></button>
                      </span>
                    ))}
                  </div>
                </div>

                <button className="btn btn-primary w-100 fw-bold" onClick={handleAddLesson} disabled={uploadingFile}>
                  Create Lesson
                </button>
              </div>

              {/* --- AI QUIZ ASSISTANT BUTTON --- */}
              <div className="card border-0 shadow-sm p-4 rounded-4 mb-4 bg-gradient text-primary" style={{ background: 'linear-gradient(135deg, #6610f2 0%, #0d6efd 100%)' }}>
                <h5 className="fw-bold mb-2 text-primary">✨ AI Quiz Assistant</h5>
                <p className="small text-muted mb-3">Automatically read a lesson, pasted text, or attached files to generate custom quizzes using AI.</p>
                <button className="btn btn-primary fw-bold text-white rounded-pill shadow-sm" onClick={() => setAiModalOpen(true)}>
                  Generate AI Quiz
                </button>
              </div>

              {/* MANUAL QUIZ CREATION FORM */}
              <div className="card border-0 shadow-sm p-4 rounded-4">
                <h5 className="fw-bold text-primary mb-3">Create Manual Quiz</h5>
                <label className="small fw-bold text-muted mb-1">SELECT LESSON TO ATTACH</label>
                <select className="form-select mb-3 border-primary" value={selectedLessonForQuiz} onChange={e => setSelectedLessonForQuiz(e.target.value)}>
                  <option value="">Choose a lesson...</option>
                  {lessons.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.title} {quizzes.find(q => q.lessonId === l.id) ? "(Already has quiz)" : ""}
                    </option>
                  ))}
                </select>

                {quizForm.map((q, qi) => (
                  <div key={qi} className="border-bottom mb-4 pb-3">
                    <div className="d-flex justify-content-between mb-2">
                      <label className="fw-bold small">Question {qi + 1}</label>
                      {quizForm.length > 1 && <button className="btn btn-sm text-danger p-0" onClick={() => removeQuestion(qi)}>Remove</button>}
                    </div>
                    <input className="form-control mb-2" placeholder="Question text" value={q.question} onChange={e => handleQuizFieldChange(qi, "question", e.target.value)} />
                    {q.choices.map((c, ci) => (
                      <div key={ci} className="input-group input-group-sm mb-1">
                        <div className="input-group-text bg-white border-0">
                          <input type="radio" name={`correct-${qi}`} checked={c.isCorrect} onChange={() => handleSetCorrect(qi, ci)} />
                        </div>
                        <input className="form-control border-0 bg-light" placeholder="Choice..." value={c.text} onChange={e => handleChoiceFieldChange(qi, ci, e.target.value)} />
                        {q.choices.length > 2 && <button className="btn btn-outline-danger border-0" onClick={() => removeChoice(qi, ci)}>×</button>}
                      </div>
                    ))}
                    <button className="btn btn-sm btn-link text-decoration-none p-0 mt-1" onClick={() => addChoice(qi)}>+ Add Choice</button>
                  </div>
                ))}
                <button className="btn btn-outline-primary w-100 mb-2 btn-sm" onClick={addQuestion}>+ Add Another Question</button>
                <button className="btn btn-primary w-100 fw-bold" onClick={handleAddQuiz}>Publish Quiz</button>
              </div>
            </div>

            <div className="col-lg-7">
              <h5 className="fw-bold mb-3">Curriculum Preview</h5>
              {lessons.map((l) => {
                const attachedQuiz = quizzes.find(q => q.lessonId === l.id);
                return (
                  <div key={l.id} className="card border-0 shadow-sm mb-4 rounded-4 overflow-hidden">
                    <div className="card-body p-4">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div>
                          <h5 className="fw-bold mb-0">{l.title}</h5>
                        </div>
                        <div className="d-flex gap-2">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => setEditLessonTarget(l)}>Edit Lesson</button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget({ type: "lesson", id: l.id })}>Delete</button>
                        </div>
                      </div>
                      <p className="text-muted small text-truncate" style={{ maxWidth: "400px" }}>{l.description}</p>

                      {l.files?.length > 0 && (
                        <div className="mb-2 d-flex flex-wrap gap-1">
                          {l.files.map((file, fi) => (
                            <span key={fi} className="badge bg-light text-dark border small text-decoration-none p-2" style={{ cursor: 'pointer' }} onClick={() => setPreviewFile(file)}>
                              {getFileIcon(file.type, file.url)} {file.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {l.links?.length > 0 && (
                        <div className="mb-3">
                          {l.links.map((link, li) => (
                            <span key={li} className="badge bg-light text-muted border me-1 small d-inline-flex align-items-center gap-1">
                              {getLinkIcon(link.url)} {link.title}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-top">
                        {attachedQuiz ? (
                          <div className="bg-light p-3 rounded-3 d-flex justify-content-between align-items-center">
                            <div>
                              <span className="badge bg-info text-dark mb-1">Attached Quiz</span>
                              <div className="fw-bold">{attachedQuiz.questions.length} Questions</div>
                            </div>
                            <div className="d-flex gap-2">
                              <button className="btn btn-sm btn-light border" onClick={() => setEditQuizTarget(attachedQuiz)}>Edit Quiz</button>
                              <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget({ type: "quiz", id: attachedQuiz.id })}>Delete Quiz</button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted small italic p-2 border border-dashed rounded-3">
                            No quiz attached to this lesson. Use the form on the left to add one.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* --- STUDENT VIEW ENGINE --- */
          <div className="row justify-content-center">
            <div className="col-lg-10">
              {viewMode === "list" && (
                <div>
                  <h4 className="fw-bold mb-4 text-secondary">Course Curriculum</h4>
                  {lessons.map((lesson) => {
                    const isCompleted = completedLessons.includes(lesson.id);
                    const lessonQuiz = quizzes.find(q => q.lessonId === lesson.id);
                    const quizDone = isQuizPerfect(lessonQuiz);
                    return (
                      <div key={lesson.id} className="card border-0 shadow-sm rounded-4 mb-3 p-2 border-start border-5 border-primary">
                        <div className="card-body d-flex justify-content-between align-items-center">
                          <div>
                            <h4 className="fw-bold mb-1">{lesson.title}</h4>
                            <div className="d-flex gap-3">
                              <span className={`small ${isCompleted ? 'text-success fw-bold' : 'text-muted'}`}>
                                {isCompleted ? "✓ Lesson Read" : "○ Not Read"}
                              </span>
                              {lessonQuiz && (
                                <span className={`small ${quizDone ? 'text-success fw-bold' : 'text-muted'}`}>
                                  {quizDone ? "✓ Quiz Passed" : "○ Quiz Pending"}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-primary rounded-pill px-4 fw-bold shadow-sm"
                              onClick={() => { setActiveLessonId(lesson.id); setViewMode("lesson"); }}
                            >
                              Open Lesson
                            </button>
                            {lessonQuiz && (
                              <button
                                className={`btn rounded-pill px-4 fw-bold ${quizDone ? 'btn-outline-success' : 'btn-outline-warning'}`}
                                onClick={() => { setActiveQuizId(lessonQuiz.id); setViewMode("quiz"); }}
                              >
                                {quizDone ? "Review Quiz" : "Take Quiz"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {viewMode === "lesson" && activeLesson && (
                <div className="card border-0 shadow rounded-4 p-5 bg-white">
                  <div className="d-flex justify-content-between align-items-start mb-4">
                    <div>
                      <span className="badge bg-primary px-3 py-2 rounded-pill mb-2">READING MODE</span>
                      <h1 className="fw-bolder">{activeLesson.title}</h1>
                    </div>
                    {completedLessons.includes(activeLesson.id) && <h5 className="text-success fw-bold mt-2">✓ Completed</h5>}
                  </div>
                  <hr className="mb-4" />
                  <div className="content-body mb-4" style={{ whiteSpace: "pre-wrap", fontSize: "1.15rem", lineHeight: "1.8", color: "#333" }}>
                    {activeLesson.description}
                  </div>

                  {/* LESSON FILES & ATTACHMENTS (Clicking card opens modal preview) */}
                  {activeLesson.files?.length > 0 && (
                    <div className="mb-4">
                      <h6 className="fw-bold text-muted mb-3">ATTACHED FILES & RESOURCES (CLICK TO VIEW)</h6>
                      <div className="row g-2">
                        {activeLesson.files.map((file, fi) => (
                          <div key={fi} className="col-md-6">
                            <div className="resource-link" onClick={() => setPreviewFile(file)}>
                              <span className="me-2 fs-5 d-flex align-items-center">{getFileIcon(file.type, file.url)}</span>
                              <div className="text-truncate flex-grow-1">
                                <div className="fw-bold text-dark small text-truncate">{file.name}</div>
                                <div className="text-muted" style={{ fontSize: '10px' }}>{file.size || "Attachment"} • Click to view</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* HELPFUL LINKS */}
                  {activeLesson.links?.length > 0 && (
                    <div className="mb-5">
                      <h6 className="fw-bold text-muted mb-3">HELPFUL LINKS</h6>
                      <div className="row g-2">
                        {activeLesson.links.map((link, li) => (
                          <div key={li} className="col-md-6">
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="resource-link">
                              <span className="me-2 fs-5 d-flex align-items-center">{getLinkIcon(link.url)}</span>
                              <div>
                                <div className="fw-bold text-dark small">{link.title}</div>
                                <div className="text-muted" style={{ fontSize: '10px' }}>{getSafeHostname(link.url)}</div>
                              </div>
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="d-flex justify-content-between border-top pt-4">
                    <button className="btn btn-light rounded-pill px-4 fw-bold" onClick={() => setViewMode("list")}>Back to Curriculum</button>
                    <button
                      className={`btn rounded-pill px-5 fw-bold ${completedLessons.includes(activeLesson.id) ? 'btn-success' : 'btn-primary shadow'}`}
                      onClick={() => handleCompleteLesson(activeLesson.id)}
                    >
                      {completedLessons.includes(activeLesson.id) ? "✓ Mark as Read" : "Finish Lesson"}
                    </button>
                  </div>
                </div>
              )}

              {viewMode === "quiz" && activeQuiz && (
                <div className="card border-0 shadow rounded-4 p-5 bg-white" ref={quizTopRef}>
                  <div className="d-flex justify-content-between align-items-center mb-4">
                    <h2 className="fw-bold mb-0 text-primary">{activeQuiz.title}</h2>
                    {isQuizPerfect(activeQuiz) && <span className="badge bg-success p-2 px-3 rounded-pill shadow-sm">100% Correct</span>}
                  </div>
                  <p className="text-muted mb-4">Select the correct answer for each question.</p>
                  <hr className="mb-5" />
                  {activeQuiz.questions.map((q, qi) => {
                    const answers = studentAnswers[activeQuiz.id] || {};
                    return (
                      <div key={qi} className="mb-5 p-4 border rounded-4 bg-light shadow-sm">
                        <h5 className="fw-bold mb-4">{qi + 1}. {q.question}</h5>
                        <div className="row g-3">
                          {q.choices.map((c, ci) => {
                            const selected = answers[qi] === ci;
                            let extraClass = "";
                            if (selected) {
                              extraClass = c.isCorrect ? "answer-correct" : "answer-incorrect";
                            }
                            return (
                              <div key={ci} className="col-md-6">
                                <button
                                  className={`btn w-100 text-start p-3 rounded-3 fw-bold choice-card-btn ${extraClass}`}
                                  disabled={answers[qi] !== undefined || isQuizPerfect(activeQuiz)}
                                  onClick={() => handleAnswer(activeQuiz.id, qi, ci, activeQuiz)}
                                >
                                  {c.text}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div className="d-flex gap-3 mt-4">
                    {(!isQuizOngoing || isQuizPerfect(activeQuiz)) && (
                      <button className="btn btn-light rounded-pill px-4 fw-bold" onClick={() => setViewMode("list")}>Exit Quiz</button>
                    )}
                    {Object.keys(studentAnswers[activeQuiz.id] || {}).length === activeQuiz.questions.length && !isQuizPerfect(activeQuiz) && (
                      <button
                        className="btn btn-warning rounded-pill px-4 fw-bold shadow-sm"
                        onClick={() => handleRedoQuiz(activeQuiz.id)}
                        disabled={hearts <= 0}
                      >
                        {hearts > 0 ? `Reset & Retake (-1 ❤️)` : "Out of Hearts"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- AI QUIZ GENERATION MODAL (WITH TOGGLE & FILE/IMAGE ANALYSIS) --- */}
      {aiModalOpen && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 rounded-4 shadow p-4 bg-white text-dark">
              <h4 className="fw-bold text-primary mb-3">🤖 Generate Quiz with AI</h4>
              
              {/* TOGGLE OPTIONS */}
              <div className="btn-group w-100 mb-3" role="group">
                <input 
                  type="radio" 
                  className="btn-check" 
                  name="aiInputModeOptions" 
                  id="modeLesson" 
                  checked={aiInputMode === "lesson"} 
                  onChange={() => setAiInputMode("lesson")} 
                />
                <label className="btn btn-outline-primary" htmlFor="modeLesson">Read from Lesson</label>

                <input 
                  type="radio" 
                  className="btn-check" 
                  name="aiInputModeOptions" 
                  id="modePaste" 
                  checked={aiInputMode === "paste"} 
                  onChange={() => setAiInputMode("paste")} 
                />
                <label className="btn btn-outline-primary" htmlFor="modePaste">Paste Lesson / Attach Files</label>
              </div>

              {aiInputMode === "lesson" ? (
                <>
                  <label className="form-label small fw-bold text-dark mb-1">SELECT LESSON TO READ</label>
                  <select className="form-select mb-3 border-primary text-dark" value={aiLessonTarget} onChange={e => setAiLessonTarget(e.target.value)}>
                    <option value="">Choose a lesson...</option>
                    {lessons.map(l => (
                      <option key={l.id} value={l.id}>{l.title}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="form-label small fw-bold text-dark mb-1">SELECT LESSON TO ATTACH QUIZ TO</label>
                  <select className="form-select mb-3 border-primary text-dark" value={aiLessonTarget} onChange={e => setAiLessonTarget(e.target.value)}>
                    <option value="">Choose a lesson to match with...</option>
                    {lessons.map(l => (
                      <option key={l.id} value={l.id}>{l.title}</option>
                    ))}
                  </select>

                  <label className="form-label small fw-bold text-dark mb-1">PASTE LESSON CONTENT</label>
                  <textarea 
                    className="form-control mb-3 text-dark" 
                    rows="4" 
                    placeholder="Paste text content here..."
                    value={aiPastedText}
                    onChange={e => setAiPastedText(e.target.value)}
                  />

                  <label className="form-label small fw-bold text-dark mb-1">ATTACH FILES / IMAGES FOR AI ANALYSIS</label>
                  <input 
                    type="file" 
                    multiple
                    className="form-control form-control-sm mb-2" 
                    accept="image/*,.pdf"
                    onChange={async (e) => {
                      const selectedFiles = e.target.files;
                      if (!selectedFiles || selectedFiles.length === 0) return;
                      
                      const validFiles = Array.from(selectedFiles).filter(file => {
                        const isSupported = file.type.startsWith('image/') || file.type === 'application/pdf';
                        if (!isSupported) {
                          alert(`Skipped ${file.name}: Only images and PDF files are supported for direct AI analysis.`);
                        }
                        return isSupported;
                      });

                      if (validFiles.length === 0) return;

                      setUploadingFile(true);
                      try {
                        const uploaded = [];
                        for (const file of validFiles) {
                          const fileExt = file.name.split(".").pop();
                          const fileName = `ai_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                          const filePath = `${pathId}/ai_temp/${fileName}`;
                          await supabase.storage.from("learning_paths").upload(filePath, file);
                          const { data: publicUrlData } = supabase.storage.from("learning_paths").getPublicUrl(filePath);
                          uploaded.push({
                            name: file.name,
                            url: publicUrlData.publicUrl,
                            path: filePath,
                            type: file.type,
                            size: (file.size / 1024 / 1024).toFixed(2) + " MB"
                          });
                        }
                        setAiAttachedFiles(prev => [...prev, ...uploaded]);
                      } catch (err) {
                        console.error("AI File Upload Error:", err);
                        alert("Failed to upload attachment.");
                      } finally {
                        setUploadingFile(false);
                      }
                    }}
                    disabled={uploadingFile}
                  />
                  {uploadingFile && <div className="text-muted small mb-2">Uploading file for AI analysis...</div>}

                  <div className="d-flex flex-wrap gap-2 mb-3">
                    {aiAttachedFiles.map((file, i) => (
                      <span key={i} className="badge bg-light text-dark border p-2 d-flex align-items-center gap-1 shadow-sm">
                        {getFileIcon(file.type, file.url)} <span className="text-truncate" style={{ maxWidth: "100px" }}>{file.name}</span>
                        <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={() => setAiAttachedFiles(aiAttachedFiles.filter((_, idx) => idx !== i))}></button>
                      </span>
                    ))}
                  </div>
                </>
              )}

              <label className="form-label small fw-bold text-dark mb-1">DIFFICULTY LEVEL</label>
              <select className="form-select mb-3 text-dark" value={aiDifficulty} onChange={e => setAiDifficulty(e.target.value)}>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>

              <label className="form-label small fw-bold text-dark mb-1">NUMBER OF QUESTIONS</label>
              <input 
                type="number" 
                className="form-control mb-4 text-dark" 
                min="1" 
                max="50" 
                value={aiNumQuestions} 
                onChange={e => setAiNumQuestions(Math.max(1, parseInt(e.target.value) || 1))} 
              />

              <div className="d-flex gap-2">
                <button className="btn btn-primary w-100 fw-bold py-2" onClick={handleGenerateAiQuiz} disabled={isGeneratingAi || uploadingFile}>
                  {isGeneratingAi ? "Reading & Generating..." : "Generate & Attach Quiz"}
                </button>
                <button className="btn btn-outline-secondary w-100 fw-bold py-2" onClick={() => setAiModalOpen(false)} disabled={isGeneratingAi}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- AI GENERATION SUCCESS MODAL --- */}
      {aiSuccessModalOpen && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content border-0 rounded-4 shadow p-4 text-center bg-white text-dark">
              <div className="mb-3">
                <span style={{ fontSize: '3rem' }}>🎉</span>
              </div>
              <h5 className="fw-bold mb-2">Success!</h5>
              <p className="text-muted small mb-4">AI Quiz successfully generated and attached to your lesson!</p>
              <button className="btn btn-primary w-100 rounded-pill fw-bold" onClick={() => setAiSuccessModalOpen(false)}>
                Awesome
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- FILE PREVIEW MODAL --- */}
      {previewFile && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered modal-xl" style={{ height: '90vh' }}>
            <div className="modal-content border-0 rounded-4 shadow h-100 bg-dark text-white d-flex flex-column overflow-hidden">
              <div className="modal-header border-secondary px-4 py-3 flex-shrink-0">
                <div className="d-flex align-items-center gap-2 text-truncate">
                  <span className="fs-4">{getFileIcon(previewFile.type, previewFile.url)}</span>
                  <h5 className="fw-bold mb-0 text-truncate">{previewFile.name}</h5>
                </div>
                <div className="d-flex gap-2 align-items-center">
                  <a href={previewFile.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-light">
                    Open in New Tab ↗
                  </a>
                  <button type="button" className="btn-close btn-close-white" onClick={() => setPreviewFile(null)}></button>
                </div>
              </div>
              <div className="modal-body p-0 flex-grow-1 bg-black overflow-y-auto" style={{ minHeight: '60vh' }}>
                {renderFileViewerContent(previewFile)}
              </div>
              <div className="modal-footer border-secondary px-4 py-2 justify-content-between flex-shrink-0">
                <span className="text-muted small">{previewFile.size || "File Attachment"}</span>
                <button type="button" className="btn btn-secondary btn-sm px-4 rounded-pill" onClick={() => setPreviewFile(null)}>Close Preview</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- HEART STATUS MODAL (STUDENT ONLY) --- */}
      {showHeartModal && user?.role === "student" && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 rounded-4 shadow p-4 text-center">
              <div className="mb-3">
                <span style={{ fontSize: '4rem' }}>❤️</span>
              </div>
              {hearts >= 5 ? (
                <>
                  <h3 className="fw-bold">Hearts are Full!</h3>
                  <p className="text-muted">You are in peak condition. Go ahead and tackle those quizzes!</p>
                </>
              ) : (
                <>
                  <h3 className="fw-bold">Next Heart In</h3>
                  <h2 className="text-primary fw-bolder mb-3">{nextHeartTime || "Calculating..."}</h2>
                  <p className="text-muted">Hearts are used to retry quizzes you didn't perfect. One heart regenerates every 3 hours.</p>
                </>
              )}

              <div className="bg-light p-3 rounded-4 mb-4 border border-primary">
                <h6 className="fw-bold mb-1 text-primary">✨ Unlimited Hearts</h6>
                <p className="small mb-2">Never wait for hearts again with a Pro subscription.</p>
                <button className="btn btn-primary w-100 rounded-pill fw-bold" onClick={() => alert("Subscription feature coming soon!")}>Subscribe Now</button>
              </div>

              <button className="btn btn-light w-100 rounded-pill fw-bold" onClick={() => setShowHeartModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* --- ADMIN / PROFESSOR / ADMIN ASSISTANT EDIT LESSON MODAL --- */}
      {editLessonTarget && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)", overflowY: "auto" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 rounded-4 shadow">
              <div className="modal-body p-4">
                <h5 className="fw-bold mb-3">Edit Lesson</h5>
                <input className="form-control mb-2" value={editLessonTarget.title} onChange={e => setEditLessonTarget({ ...editLessonTarget, title: e.target.value })} />
                <textarea className="form-control mb-3" rows="5" value={editLessonTarget.description} onChange={e => setEditLessonTarget({ ...editLessonTarget, description: e.target.value })} />

                <div className="bg-light p-3 rounded-3 mb-3 border">
                  <label className="small fw-bold mb-2">UPDATE ATTACHMENTS / FILES</label>
                  <input 
                    type="file" 
                    multiple
                    className="form-control form-control-sm mb-2" 
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,video/*"
                    onChange={(e) => handleFileUpload(e.target.files, true)}
                    disabled={uploadingFile}
                  />
                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {editLessonTarget.files?.map((file, i) => (
                      <span key={i} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-1 shadow-sm" style={{ cursor: 'pointer' }} onClick={() => setPreviewFile(file)}>
                        {getFileIcon(file.type, file.url)} <span className="text-truncate" style={{ maxWidth: "100px" }}>{file.name}</span>
                        <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={(e) => { e.stopPropagation(); removeFileFromForm(i, true); }}></button>
                      </span>
                    ))}
                  </div>

                  <hr className="my-2" />

                  <label className="small fw-bold mb-2">UPDATE LINKS</label>
                  <div className="input-group input-group-sm mb-2">
                    <input className="form-control" placeholder="Title" value={linkInput.title} onChange={e => setLinkInput({ ...linkInput, title: e.target.value })} />
                    <input className="form-control" placeholder="URL" value={linkInput.url} onChange={e => setLinkInput({ ...linkInput, url: e.target.value })} />
                    <button className="btn btn-dark" onClick={() => {
                      if (!linkInput.title || !linkInput.url) return;
                      setEditLessonTarget({ ...editLessonTarget, links: [...(editLessonTarget.links || []), linkInput] });
                      setLinkInput({ title: "", url: "" });
                    }}>Add</button>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    {editLessonTarget.links?.map((link, i) => (
                      <span key={i} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-2">
                        {getLinkIcon(link.url)} {link.title}
                        <button className="btn-close ms-2" style={{ fontSize: '8px' }} onClick={() => setEditLessonTarget({ ...editLessonTarget, links: editLessonTarget.links.filter((_, idx) => idx !== i) })}></button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="d-flex gap-2">
                  <button className="btn btn-primary w-100" onClick={handleUpdateLesson} disabled={uploadingFile}>Update</button>
                  <button className="btn btn-light w-100" onClick={() => setEditLessonTarget(null)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- EDIT QUIZ MODAL --- */}
      {editQuizTarget && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", overflowY: "auto" }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border-0 rounded-4 shadow">
              <div className="modal-header border-0 p-4 pb-0"><h5 className="fw-bold">Edit Quiz Details</h5></div>
              <div className="modal-body p-4">
                <input className="form-control mb-4 fw-bold border-primary" value={editQuizTarget.title} onChange={e => setEditQuizTarget({ ...editQuizTarget, title: e.target.value })} />
                {editQuizTarget.questions.map((q, qi) => (
                  <div key={qi} className="bg-light p-3 rounded-3 mb-3 border">
                    <input className="form-control mb-2 fw-bold" value={q.question} onChange={e => {
                      const qs = [...editQuizTarget.questions];
                      qs[qi].question = e.target.value;
                      setEditQuizTarget({ ...editQuizTarget, questions: qs });
                    }} />
                    {q.choices.map((c, ci) => (
                      <div key={ci} className="input-group mb-1">
                        <div className="input-group-text border-0 bg-transparent">
                          <input type="radio" checked={c.isCorrect} onChange={() => {
                            const qs = [...editQuizTarget.questions];
                            qs[qi].choices.forEach((choice, idx) => choice.isCorrect = idx === ci);
                            setEditQuizTarget({ ...editQuizTarget, questions: qs });
                          }} />
                        </div>
                        <input className="form-control" value={c.text} onChange={e => {
                          const qs = [...editQuizTarget.questions];
                          qs[qi].choices[ci].text = e.target.value;
                          setEditQuizTarget({ ...editQuizTarget, questions: qs });
                        }} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="modal-footer border-0 p-4 pt-0">
                <button className="btn btn-light" onClick={() => setEditQuizTarget(null)}>Cancel</button>
                <button className="btn btn-primary px-4 fw-bold" onClick={handleUpdateQuiz}>Save Quiz Updates</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- DELETE CONFIRMATION MODAL --- */}
      {deleteTarget && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content border-0 rounded-4 p-4 text-center shadow">
              <h6 className="fw-bold mb-3 text-danger">Are you sure?</h6>
              <p className="small text-muted mb-3">Deleting this {deleteTarget.type} cannot be undone.</p>
              <div className="d-flex gap-2">
                <button className="btn btn-danger w-100" onClick={confirmDelete}>Delete</button>
                <button className="btn btn-light w-100" onClick={() => setDeleteTarget(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ViewPath;