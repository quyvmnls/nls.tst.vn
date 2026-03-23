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
let userAnswers = {}; // Lưu đáp án thí sinh { 'id_cau_hoi': 'đáp án' }
let totalSeconds = 120 * 60; // 120 phút
let timerInterval;
let lockedParts = []; // Danh sách các phần thi đã bị khóa

// 3. ĐĂNG NHẬP
function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('exam-code').value; // Dùng mã dự thi làm password
    const errorMsg = document.getElementById('login-error');

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            document.getElementById('login-screen').classList.remove('active');
            document.getElementById('exam-screen').classList.add('active');
            document.getElementById('student-email').innerText = email;
            
            // Bật Fullscreen (Chống gian lận)
            document.documentElement.requestFullscreen().catch(e => console.log(e));
            
            startExam();
        })
        .catch((error) => {
            errorMsg.innerText = "Sai Email hoặc Mã dự thi. Hoặc tài khoản chưa được tạo!";
        });
}

// 4. BẮT ĐẦU THI VÀ TẢI DỮ LIỆU THẬT
async function startExam() {
    try {
        // Gọi dữ liệu từ Firebase và sắp xếp theo 'part' (Phần 1 -> 2 -> 3)
        const snapshot = await db.collection('questions').orderBy('part').get();
        
        questions = []; // Làm rỗng danh sách trước khi nạp
        
        snapshot.forEach(doc => {
            let q = doc.data();
            q.id = doc.id; // Lưu lại ID thật của Firebase để dùng lúc chấm điểm
            questions.push(q);
        });

        // Kiểm tra nếu chưa có câu hỏi nào
        if (questions.length === 0) {
            alert("Hệ thống chưa có câu hỏi nào! Vui lòng nhờ Admin cập nhật đề thi.");
            return; // Dừng lại, không cho thi
        }

        // Khôi phục bài làm cũ nếu học sinh lỡ tay nhấn F5 (Reload)
        const savedAnswers = localStorage.getItem('vstep_answers');
        if(savedAnswers) userAnswers = JSON.parse(savedAnswers);

        // Vẽ danh sách câu hỏi và hiển thị câu đầu tiên
        renderQuestionPalette();
        showQuestion(0);
        startTimer();
        setupAntiCheat();
        
    } catch (error) {
        console.error("Lỗi tải đề thi: ", error);
        alert("Không thể tải đề thi. Vui lòng kiểm tra lại kết nối mạng!");
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
function showQuestion(index) {
    if(index < 0 || index >= questions.length) return;
    currentQuestionIndex = index;
    const q = questions[index];

    document.getElementById('current-part-display').innerText = `Part ${q.part}: ${q.type.toUpperCase()}`;
    document.getElementById('question-number').innerText = `Câu hỏi ${index + 1}`;
    document.getElementById('question-text').innerText = q.content;
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    // Kiểm tra xem phần thi này đã bị khóa chưa
    const isLocked = lockedParts.includes(parseInt(q.part));
    const disabledAttr = isLocked ? 'disabled' : ''; // Lệnh chặn click

    if (q.type === 'mcq' || q.type === 'truefalse') {
        q.options.forEach(opt => {
            // Tự động dịch sang tiếng Việt trên giao diện
            let labelText = opt;
            if (q.type === 'truefalse') {
                if (opt === 'True') labelText = 'Đúng';
                if (opt === 'False') labelText = 'Sai';
            }
            const isChecked = userAnswers[q.id] === opt ? 'checked' : '';
            optionsContainer.innerHTML += `
                <label style="${isLocked ? 'background: #eee; cursor: not-allowed; color: #888;' : ''}">
                    <input type="radio" name="answer" value="${opt}" ${isChecked} ${disabledAttr} onchange="saveAnswer('${q.id}', this.value)"> 
                    ${labelText}
                </label>
            `;
        });
    } else if (q.type === 'essay') {
        const savedText = userAnswers[q.id] || '';
        optionsContainer.innerHTML = `
            <textarea class="essay-box" ${disabledAttr} placeholder="${isLocked ? 'Phần này đã khóa, không thể nhập thêm.' : 'Nhập câu trả lời...'}" oninput="saveAnswer('${q.id}', this.value)">${savedText}</textarea>
        `;
    }
    updatePaletteUI();
}

// 7. HẸN GIỜ & TỰ ĐỘNG KHÓA PHẦN THI
function startTimer() {
    timerInterval = setInterval(() => {
        totalSeconds--;
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        document.getElementById('time-display').innerText = `${m}:${s}`;

        // Tính số phút đã trôi qua
        const elapsedMinutes = 120 - (totalSeconds / 60);

        // Quy tắc: Hết 45 phút -> Khóa phần 1, nhảy sang phần 2
        if (elapsedMinutes >= 45 && !lockedParts.includes(1)) {
            lockAndJump(1, 2);
        }
        // Quy tắc: Hết thêm 25 phút (Tổng 70 phút) -> Khóa phần 2, nhảy sang phần 3
        else if (elapsedMinutes >= 70 && !lockedParts.includes(2)) {
            lockAndJump(2, 3);
        }

        if (totalSeconds <= 0) {
            clearInterval(timerInterval);
            alert("Đã hết thời gian làm bài. Hệ thống tự động nộp bài!");
            submitExam(true);
        }
    }, 1000);
}

// 6. LƯU ĐÁP ÁN & CẬP NHẬT UI
function saveAnswer(questionId, answer) {
    userAnswers[questionId] = answer;
    localStorage.setItem('vstep_answers', JSON.stringify(userAnswers)); // Lưu tạm chống mất mạng
    updatePaletteUI();
}

function renderQuestionPalette() {
    const palette = document.getElementById('question-palette');
    palette.innerHTML = '';
    questions.forEach((q, index) => {
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
function submitExam(isAuto = false) {
    if (!isAuto && !confirm("Bạn có chắc chắn muốn nộp bài không? Không thể thay đổi sau khi nộp.")) return;
    
    clearInterval(timerInterval);
    const user = auth.currentUser;
    
    // Đẩy dữ liệu lên Firestore
    db.collection("submissions").add({
        studentEmail: user.email,
        answers: userAnswers,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        alert("Nộp bài thành công!");
        localStorage.removeItem('vstep_answers'); // Xóa cache
        window.location.reload(); // Thoát về trang đăng nhập
    }).catch(error => {
        alert("Lỗi khi nộp bài: " + error.message);
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

// Hàm Lưu Bài (Lưu nháp lên Firebase riêng biệt với file nộp chính thức)
function saveDraft(showAlert = true) {
    const user = auth.currentUser;
    if(!user) return;
    
    // Lưu vào thư mục 'drafts' (bản nháp), lấy email học sinh làm tên file
    db.collection("drafts").doc(user.email).set({
        studentEmail: user.email,
        answers: userAnswers,
        lastSaved: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        if(showAlert) alert("Đã lưu bài an toàn lên máy chủ!");
    }).catch(error => {
        console.error("Lỗi lưu nháp:", error);
        if(showAlert) alert("Có lỗi mạng, nhưng bài vẫn được lưu tạm trên máy của bạn.");
    });
}