// 1. CẤU HÌNH FIREBASE (Đã Thay bằng config của thầy/cô)
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBUrC1tiYfhaHZ8UvxnDooLwxndXRo5rE",
  authDomain: "hethongthinangluc.firebaseapp.com",
  projectId: "hethongthinangluc",
  storageBucket: "hethongthinangluc.firebasestorage.app",
  messagingSenderId: "214976641465",
  appId: "1:214976641465:web:1dfff725df493781a61e68",
  measurementId: "G-MPJT17BY81"
};

// Khởi tạo Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 2. BIẾN TOÀN CỤC
let questions = []; // Danh sách câu hỏi tải từ DB
let currentQuestionIndex = 0;
let currentStudentEmail = ""; // Biến lưu tài khoản học sinh đang đăng nhập
let userAnswers = {}; // Lưu đáp án thí sinh { 'id_cau_hoi': 'đáp án' }
// Cấu hình thời gian cho từng phần (tính bằng giây)
const partDurations = { 
    1: 45 * 60, // Phần 1: 45 phút
    2: 25 * 60, // Phần 2: 25 phút
    3: 50 * 60  // Phần 3: 50 phút
};
let activePart = 1; // Phần thi đang đếm ngược (Mặc định bắt đầu từ phần 1)
let partSeconds = partDurations[activePart]; // Bộ đếm lùi của phần hiện tại
let lockedParts = []; // Danh sách các phần thi đã bị khóa
let timerInterval;

// === 3. ĐĂNG NHẬP (Bằng Firestore) ===
function login() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('exam-code').value.trim();
    const errorMsg = document.getElementById('login-error');

    if(!email || !password) { errorMsg.innerText = "Vui lòng nhập đủ thông tin!"; return; }

    // Dò tìm tài khoản trong CSDL
    db.collection("students").doc(email).get().then((doc) => {
        if (doc.exists && doc.data().password === password) {
            
            currentStudentEmail = email; // Ghi nhớ tài khoản để lát nữa nộp bài
            const studentName = doc.data().name; // Lấy tên thật

            document.getElementById('login-screen').classList.remove('active');
            
            const waitingScreen = document.getElementById('waiting-screen');
            if (waitingScreen) waitingScreen.classList.add('active');
            
            // Hiển thị Tên thật và Tài khoản lên màn hình
            document.getElementById('wait-email').innerText = `${studentName} (${email})`;
            document.getElementById('student-email').innerText = studentName;
            
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            errorMsg.innerText = "Sai Tài khoản hoặc Mật khẩu dự thi!";
        }
    }).catch(error => {
        errorMsg.innerText = "Lỗi kết nối máy chủ!";
        console.error(error);
    });
}

// === 4. BẮT ĐẦU THI VÀ TẢI DỮ LIỆU THẬT ===
async function startExam() {
    const btnStart = document.getElementById('btn-start-exam');
    btnStart.innerText = "Đang tải đề thi từ máy chủ...";
    btnStart.disabled = true;

    try {
        const snapshot = await db.collection('questions').orderBy('part').get();
        
        let p1 = [], p2 = [], p3 = []; // 3 giỏ chứa câu hỏi của 3 phần
        
        // Hàm hỗ trợ xáo trộn mảng (Fisher-Yates Shuffle)
        const shuffleArray = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        snapshot.forEach(doc => {
            let q = doc.data();
            q.id = doc.id;
            
            // Nếu là Trắc nghiệm, xáo trộn sẵn các đáp án và lưu vào một biến phụ
            // Việc này giúp đáp án không bị nhảy loạn xạ nếu học sinh bấm "Câu trước / Câu tiếp"
            if (q.type === 'mcq') {
                q.randomOptions = shuffleArray([...q.options]);
            }

            // Phân loại vào từng giỏ
            if (q.part == 1) p1.push(q);
            else if (q.part == 2) p2.push(q);
            else if (q.part == 3) p3.push(q);
        });

        // Xóc đều từng giỏ rồi ghép lại thành danh sách câu hỏi chính thức
        questions = [...shuffleArray(p1), ...shuffleArray(p2), ...shuffleArray(p3)];

        if (questions.length === 0) {
            alert("Hệ thống chưa có câu hỏi nào! Vui lòng đẩy đề thi lên từ trang Admin.");
            btnStart.innerText = "Nhận Đề & Bắt Đầu Thi";
            btnStart.disabled = false;
            return;
        }

        const savedAnswers = localStorage.getItem('vstep_answers');
        if(savedAnswers) userAnswers = JSON.parse(savedAnswers);

        document.getElementById('waiting-screen').classList.remove('active');
        document.getElementById('exam-screen').classList.add('active');

        renderQuestionPalette();
        showQuestion(0, true); 
        startTimer();
        setupAntiCheat();
        
    } catch (error) {
        console.error("Lỗi tải đề thi: ", error);
        alert("Không thể tải đề thi. Vui lòng kiểm tra lại kết nối mạng!");
        btnStart.innerText = "Nhận Đề & Bắt Đầu Thi";
        btnStart.disabled = false;
    }
}

// 4. HÀM ĐỌC FILE EXCEL VÀ ĐẨY LÊN FIREBASE
        function importExcel() {
            const fileInput = document.getElementById('excel-file');
            const file = fileInput.files[0];
            
            if (!file) {
                alert("Vui lòng chọn một file Excel (.xlsx) trước!");
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheetName = workbook.SheetNames[0]; // Lấy sheet đầu tiên
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Chuyển Excel thành mảng dữ liệu (bỏ qua hàng tiêu đề)
                const json = XLSX.utils.sheet_to_json(worksheet, {header: 1});
                
                let successCount = 0;
                const batch = db.batch(); // Dùng tính năng Batch của Firebase để lưu nhiều câu cùng lúc
                const questionsRef = db.collection("questions");

                // Vòng lặp bắt đầu từ i = 1 (bỏ qua hàng 0 là tiêu đề)
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0 || !row[0]) continue; // Bỏ qua nếu dòng trống

                    const part = parseInt(row[0]);
                    const content = row[1];
                    let type = "";
                    let options = [];
                    let correctAnswer = "";

                    if (part === 1) {
                        type = "mcq";
                        options = [`A. ${row[2] || ''}`, `B. ${row[3] || ''}`, `C. ${row[4] || ''}`, `D. ${row[5] || ''}`];
                        const correctLetter = row[6] ? row[6].toString().trim().toUpperCase() : "";
                        if(correctLetter === 'A') correctAnswer = options[0];
                        if(correctLetter === 'B') correctAnswer = options[1];
                        if(correctLetter === 'C') correctAnswer = options[2];
                        if(correctLetter === 'D') correctAnswer = options[3];
                    } 
                    else if (part === 2) {
                        type = "truefalse";
                        options = ["True", "False"];
                        let ans = row[6] ? row[6].toString().trim().toLowerCase() : "";
                        if(ans === 'đúng' || ans === 'true') correctAnswer = "True";
                        if(ans === 'sai' || ans === 'false') correctAnswer = "False";
                    } 
                    else if (part === 3) {
                        type = "essay";
                        options = [];
                        correctAnswer = "Chờ giáo viên chấm";
                    }

                    // Đưa câu hỏi vào gói chờ đẩy lên Firebase
                    const docRef = questionsRef.doc(); 
                    batch.set(docRef, {
                        part: part,
                        type: type,
                        content: content,
                        options: options,
                        correctAnswer: correctAnswer,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    successCount++;
                }

                // Tiến hành đẩy toàn bộ gói lên mạng
                batch.commit().then(() => {
                    alert(`Tuyệt vời! Đã đưa thành công ${successCount} câu hỏi từ file Excel lên hệ thống.`);
                    fileInput.value = ""; // Xóa tên file đã chọn
                }).catch(error => {
                    alert("Có lỗi xảy ra khi tải dữ liệu lên: " + error.message);
                });
            };
            
            reader.readAsArrayBuffer(file);
        }

// 5. HIỂN THỊ CÂU HỎI (Đã nâng cấp chức năng Khóa)
// 5. HIỂN THỊ CÂU HỎI VÀ CHẶN NHẢY CÓC
function showQuestion(index, skipCheck = false) {
    if(index < 0 || index >= questions.length) return;
    
    const targetQ = questions[index];
    const targetPart = parseInt(targetQ.part);

    // BẢO VỆ: Nếu thí sinh click vào câu hỏi của phần sau khi chưa nộp phần trước
    if (!skipCheck && targetPart > activePart) {
        alert(`Bạn đang ở Phần ${activePart}. Nếu làm xong, vui lòng bấm nút "Chuyển Phần Thi" ở cột bên trái để sang Phần ${targetPart}!`);
        return; // Chặn không cho hiển thị
    }

    currentQuestionIndex = index;
    const q = targetQ;

    document.getElementById('current-part-display').innerText = `Part ${q.part}: ${q.type.toUpperCase()}`;
    document.getElementById('question-number').innerText = `Câu hỏi ${index + 1}`;
    document.getElementById('question-text').innerText = q.content;
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    // Kiểm tra xem phần thi này đã bị khóa chưa (để làm mờ)
    const isLocked = lockedParts.includes(parseInt(q.part));
    const disabledAttr = isLocked ? 'disabled' : ''; 

    if (q.type === 'mcq') {
        // Dùng mảng đáp án đã được xáo trộn ở bước startExam
        q.randomOptions.forEach((opt, idx) => {
            const isChecked = userAnswers[q.id] === opt ? 'checked' : '';
            
            // Cắt bỏ phần "A. ", "B. " cũ trong CSDL
            const cleanText = opt.replace(/^[A-D]\.\s*/, '');
            // Gắn lại nhãn A, B, C, D mới theo đúng thứ tự đang đứng
            const newLabel = String.fromCharCode(65 + idx) + ". " + cleanText;

            optionsContainer.innerHTML += `
                <label style="${isLocked ? 'background: #eee; cursor: not-allowed; color: #888;' : ''}">
                    <input type="radio" name="answer" value="${opt}" ${isChecked} ${disabledAttr} onchange="saveAnswer('${q.id}', this.value)"> 
                    ${newLabel}
                </label>
            `;
        });
    } 
    // -- XỬ LÝ HIỂN THỊ CÂU ĐÚNG/SAI --
    else if (q.type === 'truefalse') {
        q.options.forEach(opt => {
            let labelText = (opt === 'True') ? 'Đúng' : 'Sai';
            const isChecked = userAnswers[q.id] === opt ? 'checked' : '';
            
            optionsContainer.innerHTML += `
                <label style="${isLocked ? 'background: #eee; cursor: not-allowed; color: #888;' : ''}">
                    <input type="radio" name="answer" value="${opt}" ${isChecked} ${disabledAttr} onchange="saveAnswer('${q.id}', this.value)"> 
                    ${labelText}
                </label>
            `;
        });
    } 
    // -- XỬ LÝ CÂU TỰ LUẬN --
     else if (q.type === 'essay') {
        const savedText = userAnswers[q.id] || '';
        optionsContainer.innerHTML = `
            <textarea class="essay-box" ${disabledAttr} placeholder="${isLocked ? 'Phần này đã khóa.' : 'Nhập câu trả lời...'}" oninput="saveAnswer('${q.id}', this.value)">${savedText}</textarea>
        `;
    }
    updatePaletteUI();
}

// 7. ĐỒNG HỒ ĐẾM NGƯỢC CHO TỪNG PHẦN
function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        partSeconds--;
        const m = Math.floor(partSeconds / 60).toString().padStart(2, '0');
        const s = (partSeconds % 60).toString().padStart(2, '0');
        
        // Cập nhật text hiển thị để thí sinh biết đây là giờ của phần nào
        document.getElementById('time-display').innerText = `Phần ${activePart}: ${m}:${s}`;

        // Khi đồng hồ của phần hiện tại chạy về 0
        if (partSeconds <= 0) {
            clearInterval(timerInterval);
            if (activePart < 3) {
                alert(`Đã hết thời gian làm bài Phần ${activePart}! Hệ thống tự động lưu bài và chuyển sang phần tiếp theo.`);
                forceNextPart();
            } else {
                alert("Đã hết toàn bộ thời gian làm bài. Hệ thống tự động nộp bài!");
                submitExam(true);
            }
        }
    }, 1000);
}

// === CÁC HÀM CHUYỂN PHẦN THI CHUẨN VSTEP ===

// Xử lý khi thí sinh chủ động bấm nút "Chuyển Phần Thi"
function attemptNextPart() {
    if (activePart >= 3) return;

    const nextPartName = activePart === 1 ? "2 (Đúng/Sai)" : "3 (Tự luận)";
    const confirmMsg = `Bạn có chắc muốn sang Phần ${nextPartName} không?\n\nLƯU Ý: Khi sang phần mới, bạn sẽ KHÔNG THỂ quay lại sửa đáp án của phần trước đó!`;

    if (confirm(confirmMsg)) {
        forceNextPart();
    }
}

// Hàm thực thi việc khóa phần cũ, nhảy phần mới
function forceNextPart() {
    lockedParts.push(activePart); // Khóa vĩnh viễn phần vừa làm
    saveDraft(false); // Lưu nháp dự phòng lên máy chủ
    
    activePart++; // Nhảy sang phần tiếp theo
    partSeconds = partDurations[activePart]; // Reset đồng hồ bằng đúng thời gian phần mới
    
    // Nếu đã sang phần cuối cùng (Phần 3), thì giấu nút "Chuyển Phần" đi
    if (activePart === 3) {
        document.getElementById('btn-next-part').style.display = 'none';
    }
    
    // Tìm câu hỏi đầu tiên của phần mới và hiển thị ngay lập tức
    const firstQIndex = questions.findIndex(q => parseInt(q.part) === activePart);
    if (firstQIndex !== -1) {
        showQuestion(firstQIndex, true); // true = Bỏ qua lớp bảo vệ để hệ thống tự nhảy
    }
    
    startTimer(); // Kích hoạt lại đồng hồ
}

// 6. LƯU ĐÁP ÁN & CẬP NHẬT UI
function saveAnswer(questionId, answer) {
    userAnswers[questionId] = answer;
    localStorage.setItem('vstep_answers', JSON.stringify(userAnswers)); // Lưu tạm chống mất mạng
    updatePaletteUI();
}

// HÀM VẼ DANH SÁCH CÂU HỎI BÊN TRÁI (Đã tách phần)
function renderQuestionPalette() {
    const palette = document.getElementById('question-palette');
    palette.innerHTML = '';
    
    let currentPartHeader = 0; // Biến nhớ xem đang vẽ đến phần nào
    
    questions.forEach((q, index) => {
        // Nếu phát hiện chuyển sang phần mới, tạo ra một dòng Tiêu đề
        if (parseInt(q.part) !== currentPartHeader) {
            currentPartHeader = parseInt(q.part);
            
            const header = document.createElement('div');
            header.className = 'part-header';
            
            let partName = `Phần ${currentPartHeader}`;
            if(currentPartHeader === 1) partName = "Phần 1: Trắc nghiệm";
            if(currentPartHeader === 2) partName = "Phần 2: Đúng/Sai";
            if(currentPartHeader === 3) partName = "Phần 3: Tự luận";
            
            header.innerText = partName;
            palette.appendChild(header);
        }
        
        // Vẽ nút câu hỏi bình thường
        const btn = document.createElement('div');
        btn.className = 'q-btn';
        btn.innerText = index + 1;
        btn.onclick = () => showQuestion(index);
        palette.appendChild(btn);
    });
}

function updatePaletteUI() {
    const buttons = document.querySelectorAll('.q-btn');
    buttons.forEach((btn, index) => {
        const qId = questions[index].id;
        btn.className = 'q-btn'; // Reset
        if (userAnswers[qId] && userAnswers[qId].trim() !== '') btn.classList.add('answered');
        if (index === currentQuestionIndex) btn.classList.add('current');
    });
}


// 8. NỘP BÀI LÊN FIREBASE
// NỘP BÀI LÊN FIREBASE
function submitExam(isAuto = false) {
    if (!isAuto && !confirm("Bạn có chắc chắn muốn nộp bài không? Không thể thay đổi sau khi nộp.")) return;
    
    clearInterval(timerInterval);
    
    db.collection("submissions").add({
        studentEmail: currentStudentEmail, // Dùng tài khoản đang lưu ở biến toàn cục
        answers: userAnswers,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        alert("Nộp bài thành công! Phần tự luận sẽ được giáo viên chấm sau.");
        localStorage.removeItem('vstep_answers'); 
        window.location.reload(); 
    }).catch(error => {
        alert("Lỗi khi nộp bài: " + error.message);
    });
}

// LƯU NHÁP DỰ PHÒNG
function saveDraft(showAlert = true) {
    if(!currentStudentEmail) return;
    
    db.collection("drafts").doc(currentStudentEmail).set({
        studentEmail: currentStudentEmail,
        answers: userAnswers,
        lastSaved: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        if(showAlert) alert("Đã lưu bài an toàn lên máy chủ!");
    }).catch(error => {
        if(showAlert) alert("Có lỗi mạng, nhưng bài vẫn được lưu tạm trên máy của bạn.");
    });
}

// 9. CHỐNG GIAN LẬN CƠ BẢN
function setupAntiCheat() {
    // Chặn click chuột phải
    document.addEventListener('contextmenu', event => event.preventDefault());
    
    // Cảnh báo khi đổi Tab
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            document.getElementById('cheat-warning').style.display = 'block';
            console.warn("Thí sinh vừa rời khỏi tab bài thi!");
            // Có thể ghi log số lần vi phạm lên Firebase tại đây
        }
    });
}

// --- CÁC HÀM TÍNH NĂNG MỚI ---

// Hàm xử lý khóa phần cũ và chuyển sang phần mới
function lockAndJump(partToLock, nextPart) {
    lockedParts.push(partToLock); // Đưa vào danh sách cấm
    saveDraft(false); // Lưu nháp dữ liệu tự động
    
    alert(`Đã hết thời gian cho Phần ${partToLock}! Hệ thống tự động khóa phần này và chuyển sang Phần ${nextPart}.`);
    
    // Tìm câu hỏi đầu tiên của phần tiếp theo để hiển thị
    const firstQOfNextPart = questions.findIndex(q => parseInt(q.part) === nextPart);
    if (firstQOfNextPart !== -1) {
        showQuestion(firstQOfNextPart);
    }
}
