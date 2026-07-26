import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { supabase } from "../supabase"; 
import { doc, getDoc, updateDoc } from "firebase/firestore";

function ViewLesson() {
  const location = useLocation();
  const navigate = useNavigate();
  const { classId, contentId } = location.state || {};

  const [user, setUser] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [isEditing, setIsEditing] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [removedFiles, setRemovedFiles] = useState([]); 
  
  const [editData, setEditData] = useState({ 
    title: "", 
    content: "", 
    videoUrl: "", 
    links: [], 
    attachments: [] 
  });

  // Modal for deleting an attached file
  const [fileDeleteModal, setFileDeleteModal] = useState({ show: false, file: null });
  const [deletingFile, setDeletingFile] = useState(false);

  // Modal for viewing/previewing attached files
  const [previewModal, setPreviewModal] = useState({ show: false, file: null });
  
  const [newLinkInput, setNewLinkInput] = useState({ title: "", url: "" });

  const getLinkIcon = (url) => {
    try {
      const domain = new URL(url).hostname;
      return (
        <img 
          src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`} 
          alt="icon" 
          style={{ width: '18px', height: '18px', objectFit: 'contain', borderRadius: '3px' }} 
        />
      );
    } catch (e) {
      return <span>🔗</span>;
    }
  };

  const getStoragePath = (file) => {
    if (file.path) return file.path;
    if (!file.url) return null;

    try {
      const urlObj = new URL(file.url);
      const pathSegments = urlObj.pathname.split("/class_files/");
      if (pathSegments.length > 1) {
        return decodeURIComponent(pathSegments[1]);
      }
    } catch (e) {
      console.error("Invalid file URL:", file.url);
    }
    return null;
  };

  // --- CONFIRM MODAL FILE DELETE ---
  const handleConfirmFileDelete = async () => {
    const fileToDelete = fileDeleteModal.file;
    if (!fileToDelete) return;

    setDeletingFile(true);
    try {
      const filePath = getStoragePath(fileToDelete);

      if (filePath) {
        const { error: storageErr } = await supabase.storage
          .from("class_files")
          .remove([filePath]);

        if (storageErr) console.error("Supabase Storage error:", storageErr);
      }

      const updatedAttachments = (lesson.attachments || []).filter(
        (f) => f.url !== fileToDelete.url
      );

      const lessonRef = doc(db, `classes/${classId}/content`, contentId);
      await updateDoc(lessonRef, { attachments: updatedAttachments });

      setLesson((prev) => ({ ...prev, attachments: updatedAttachments }));
      setEditData((prev) => ({ ...prev, attachments: updatedAttachments }));
      setFileDeleteModal({ show: false, file: null });
    } catch (err) {
      console.error("Failed to delete file:", err);
    } finally {
      setDeletingFile(false);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) return navigate("/login");
      
      const userDoc = await getDoc(doc(db, "users", currentUser.uid));
      setUser({ uid: currentUser.uid, ...userDoc.data() });

      if (classId && contentId) {
        const lessonSnap = await getDoc(doc(db, `classes/${classId}/content`, contentId));
        if (lessonSnap.exists()) {
          const data = lessonSnap.data();
          setLesson(data);
          setEditData({
            ...data,
            links: data.links || [],
            attachments: data.attachments || []
          }); 
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [classId, contentId, navigate]);

  const addLinkToEdit = () => {
    if (!newLinkInput.title || !newLinkInput.url) return;
    setEditData({
      ...editData,
      links: [...editData.links, newLinkInput]
    });
    setNewLinkInput({ title: "", url: "" });
  };

  const removeLinkFromEdit = (index) => {
    const updatedLinks = editData.links.filter((_, i) => i !== index);
    setEditData({ ...editData, links: updatedLinks });
  };

  const handleFileSelection = (e) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const removeAttachmentFromEdit = (index) => {
    const fileToRemove = editData.attachments[index];
    if (fileToRemove) {
      setRemovedFiles(prev => [...prev, fileToRemove]);
    }
    const updatedAttachments = editData.attachments.filter((_, i) => i !== index);
    setEditData({ ...editData, attachments: updatedAttachments });
  };

  const handleSave = async () => {
    setUploadingFile(true);
    try {
      if (removedFiles.length > 0) {
        const pathsToDelete = removedFiles
          .map(getStoragePath)
          .filter(Boolean);

        if (pathsToDelete.length > 0) {
          await supabase.storage.from("class_files").remove(pathsToDelete);
        }
      }

      const uploadedAttachments = [...(editData.attachments || [])];

      for (const file of selectedFiles) {
        const fileExt = file.name.split(".").pop();
        const filePath = `class_files/${classId}/${Date.now()}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("class_files")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("class_files")
          .getPublicUrl(filePath);

        uploadedAttachments.push({
          name: file.name,
          url: publicUrlData.publicUrl,
          path: filePath,
          type: file.type,
          ext: fileExt
        });
      }

      const updatedPayload = {
        ...editData,
        attachments: uploadedAttachments
      };

      const lessonRef = doc(db, `classes/${classId}/content`, contentId);
      await updateDoc(lessonRef, updatedPayload);
      
      setLesson(updatedPayload);
      setEditData(updatedPayload);
      setSelectedFiles([]);
      setRemovedFiles([]);
      setIsEditing(false);
    } catch (err) {
      console.error("Error updating lesson:", err);
    } finally {
      setUploadingFile(false);
    }
  };

  const renderFileViewerContent = (file) => {
    if (!file) return null;
    const isDoc = file.ext === "doc" || file.ext === "docx" || file.ext === "ppt" || file.ext === "pptx";
    const isPdf = file.ext === "pdf" || file.type?.includes("pdf");

    if (file.type?.startsWith("video/")) {
      return (
        <video controls className="w-100 rounded-3" style={{ maxHeight: "75vh" }}>
          <source src={file.url} type={file.type} />
        </video>
      );
    }

    if (file.type?.startsWith("image/")) {
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

    // Default viewer (PDF, plain text, or inline browser supported documents)
    return (
      <iframe 
        src={file.url} 
        title={file.name} 
        className="w-100 border-0 rounded-3" 
        style={{ height: "75vh" }}
      />
    );
  };

  if (loading) return <div className="text-center py-5">Loading Lesson...</div>;
  if (!lesson) return <div className="text-center py-5">Lesson not found.</div>;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          
          <div className="d-flex justify-content-between align-items-center mb-4">
            <button className="btn btn-sm btn-outline-secondary rounded-pill px-3" onClick={() => navigate(-1)}>
              &larr; Back to Class
            </button>
            
            {user?.role === "professor" && (
              <div>
                {isEditing ? (
                  <>
                    <button className="btn btn-success btn-sm rounded-pill px-3 me-2" onClick={handleSave} disabled={uploadingFile}>
                      {uploadingFile ? "Saving..." : "Save Changes"}
                    </button>
                    <button 
                      className="btn btn-light btn-sm rounded-pill px-3" 
                      onClick={() => {
                        setIsEditing(false);
                        setRemovedFiles([]);
                        setSelectedFiles([]);
                      }} 
                      disabled={uploadingFile}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={() => setIsEditing(true)}>Edit Lesson</button>
                )}
              </div>
            )}
          </div>

          <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
            {lesson.videoUrl && !isEditing && (
              <div className="ratio ratio-16x9 bg-dark">
                <iframe 
                  src={lesson.videoUrl.replace("watch?v=", "embed/")} 
                  title="Lesson Video" 
                  allowFullScreen
                ></iframe>
              </div>
            )}

            <div className="card-body p-4 p-md-5">
              {isEditing ? (
                <div className="edit-form">
                  <label className="form-label fw-bold small text-muted">LESSON TITLE</label>
                  <input 
                    type="text" 
                    className="form-control form-control-lg mb-4" 
                    value={editData.title} 
                    onChange={(e) => setEditData({...editData, title: e.target.value})}
                  />

                  <label className="form-label fw-bold small text-muted">LESSON CONTENT</label>
                  <textarea 
                    className="form-control mb-4" 
                    rows="10" 
                    value={editData.content} 
                    onChange={(e) => setEditData({...editData, content: e.target.value})}
                  ></textarea>

                  <div className="p-3 bg-light rounded-3 border mb-3">
                    <label className="form-label fw-bold small text-primary mb-2 d-block">
                      UPLOAD NEW ATTACHMENTS (PDF, DOCX, PPTX, MP4, IMAGES)
                    </label>
                    <input 
                      type="file" 
                      multiple 
                      className="form-control mb-3" 
                      accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx"
                      onChange={handleFileSelection}
                    />

                    {editData.attachments?.length > 0 && (
                      <div className="mb-2">
                        <small className="fw-bold text-muted d-block mb-2">CURRENT ATTACHMENTS</small>
                        <div className="d-flex flex-wrap gap-2">
                          {editData.attachments.map((file, index) => (
                            <div key={index} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-2 shadow-sm">
                              <span className="text-truncate" style={{ maxWidth: "180px" }}>📄 {file.name}</span>
                              <button 
                                type="button" 
                                className="btn-close" 
                                style={{ fontSize: "0.6rem" }} 
                                onClick={() => removeAttachmentFromEdit(index)}
                              ></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-light rounded-3 border">
                    <label className="form-label fw-bold small text-primary">MANAGE EXTERNAL LINKS</label>
                    
                    <div className="input-group input-group-sm mb-3">
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="Link Title" 
                        value={newLinkInput.title}
                        onChange={(e) => setNewLinkInput({...newLinkInput, title: e.target.value})}
                      />
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="URL (https://...)" 
                        value={newLinkInput.url}
                        onChange={(e) => setNewLinkInput({...newLinkInput, url: e.target.value})}
                      />
                      <button className="btn btn-primary" type="button" onClick={addLinkToEdit}>Add</button>
                    </div>

                    <div className="d-flex flex-wrap gap-2">
                      {editData.links.map((link, index) => (
                        <div key={index} className="badge bg-white text-dark border p-2 d-flex align-items-center gap-2 shadow-sm">
                          {getLinkIcon(link.url)}
                          <span className="text-truncate" style={{maxWidth: '150px'}}>{link.title}</span>
                          <button 
                            type="button" 
                            className="btn-close" 
                            style={{fontSize: '0.6rem'}} 
                            onClick={() => removeLinkFromEdit(index)}
                          ></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <article>
                  <h1 className="display-5 fw-bold mb-3">{lesson.title}</h1>
                  <hr className="my-4 opacity-10" />
                  
                  <div className="lesson-text mb-4" style={{ whiteSpace: "pre-wrap", lineHeight: "1.8", fontSize: "1.1rem" }}>
                    {lesson.content}
                  </div>

                  {lesson.attachments && lesson.attachments.length > 0 && (
                    <div className="mt-4 p-4 bg-light rounded-4 border">
                      <h6 className="fw-bold text-muted mb-3 small uppercase">📎 ATTACHED MEDIA & FILES</h6>
                      <div className="row g-3">
                        {lesson.attachments.map((file, index) => (
                          <div key={index} className="col-12">
                            <div className="card border-0 shadow-sm rounded-3 overflow-hidden bg-white">
                              
                              {/* HEADER: CLICK TO PREVIEW */}
                              <div className="card-header bg-white border-bottom-0 pt-3 px-3 pb-0 d-flex align-items-center justify-content-between">
                                <div 
                                  className="d-flex align-items-center gap-2 text-truncate role-button cursor-pointer" 
                                  style={{ cursor: "pointer" }}
                                  onClick={() => setPreviewModal({ show: true, file })}
                                >
                                  <span className="fs-5">
                                    {file.type?.startsWith("video/") ? "🎥" : file.type?.startsWith("image/") ? "🖼️" : "📄"}
                                  </span>
                                  <span className="fw-bold text-dark text-truncate small hover-underline">{file.name}</span>
                                </div>

                                {user?.role === "professor" && (
                                  <div className="dropdown ms-2">
                                    <button 
                                      className="btn btn-light btn-sm rounded-circle p-1 d-flex align-items-center justify-content-center" 
                                      type="button" 
                                      data-bs-toggle="dropdown" 
                                      aria-expanded="false"
                                      style={{ width: "32px", height: "32px" }}
                                    >
                                      <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                        <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                                      </svg>
                                    </button>
                                    <ul className="dropdown-menu dropdown-menu-end shadow-sm border-0 rounded-3">
                                      <li>
                                        <button 
                                          className="dropdown-item text-danger small d-flex align-items-center gap-2" 
                                          onClick={() => setFileDeleteModal({ show: true, file })}
                                        >
                                          <span>🗑️</span> Delete File
                                        </button>
                                      </li>
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* BODY CONTENT */}
                              <div className="card-body p-3">
                                {file.type?.startsWith("video/") ? (
                                  <video controls className="w-100 rounded-3" style={{ maxHeight: "350px" }}>
                                    <source src={file.url} type={file.type} />
                                  </video>
                                ) : file.type?.startsWith("image/") ? (
                                  <div 
                                    className="text-center bg-light rounded-3 p-2 cursor-pointer" 
                                    style={{ cursor: "pointer" }}
                                    onClick={() => setPreviewModal({ show: true, file })}
                                  >
                                    <img src={file.url} alt={file.name} className="img-fluid rounded-3" style={{ maxHeight: "350px" }} />
                                  </div>
                                ) : (
                                  <div className="d-flex align-items-center justify-content-between pt-1">
                                    <span className="text-muted small">Click view to read inside modal</span>
                                    <div className="d-flex gap-2">
                                      <button 
                                        className="btn btn-sm btn-primary rounded-pill px-3"
                                        onClick={() => setPreviewModal({ show: true, file })}
                                      >
                                        👁️ View File
                                      </button>
                                      <a 
                                        href={file.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                                      >
                                        Download
                                      </a>
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {lesson.links && lesson.links.length > 0 && (
                    <div className="mt-4 p-4 bg-light rounded-4 border">
                      <h6 className="fw-bold text-muted mb-3 small uppercase">🔗 EXTERNAL RESOURCES</h6>
                      <div className="d-flex flex-wrap gap-2">
                        {lesson.links.map((link, index) => (
                          <a 
                            key={index} 
                            href={link.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="btn btn-white border btn-sm d-flex align-items-center gap-2 rounded-3 px-3 py-2 shadow-sm bg-white"
                          >
                            {getLinkIcon(link.url)}
                            <span>{link.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* FILE PREVIEW MODAL */}
      {previewModal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.7)", zIndex: 1050 }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-header border-bottom-0 pb-0">
                <h5 className="modal-title fw-bold text-truncate me-3">
                  📄 {previewModal.file?.name}
                </h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => setPreviewModal({ show: false, file: null })}
                ></button>
              </div>
              <div className="modal-body p-3">
                {renderFileViewerContent(previewModal.file)}
              </div>
              <div className="modal-footer border-top-0 pt-0">
                <a 
                  href={previewModal.file?.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-sm btn-outline-primary rounded-pill px-3"
                >
                  Download / Open original
                </a>
                <button 
                  className="btn btn-sm btn-secondary rounded-pill px-3" 
                  onClick={() => setPreviewModal({ show: false, file: null })}
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE FILE DELETE MODAL */}
      {fileDeleteModal.show && (
        <div className="modal d-block" style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1055 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4">
              <div className="modal-body p-4 text-center">
                <div className="display-6 text-danger mb-3">🗑️</div>
                <h5 className="fw-bold">Delete File?</h5>
                <p className="text-muted small mb-0">Are you sure you want to delete <strong>"{fileDeleteModal.file?.name}"</strong>?</p>
                <p className="text-muted small">This action cannot be undone.</p>
                <div className="d-flex gap-2 justify-content-center mt-4">
                  <button 
                    className="btn btn-light px-4 rounded-pill" 
                    onClick={() => setFileDeleteModal({ show: false, file: null })}
                    disabled={deletingFile}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-danger px-4 rounded-pill fw-bold" 
                    onClick={handleConfirmFileDelete}
                    disabled={deletingFile}
                  >
                    {deletingFile ? "Deleting..." : "Delete File"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ViewLesson;