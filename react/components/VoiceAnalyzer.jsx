import React, { useState } from 'react';
import axios from 'axios';

export default function VoiceAnalyzer() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [stressResult, setStressResult] = useState(null);
  const [error, setError] = useState(null);

  // 1. 파일 선택 핸들러
  const handleFileChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      setSelectedFile(event.target.files[0]);
      setStressResult(null); // 새 파일 선택 시 기존 결과 초기화
      setError(null);
    }
  };

  // 2. 서버로 API 호출 핸들러
  const handleAnalyzeClick = async () => {
    if (!selectedFile) {
      alert('먼저 음성 파일을 선택해주세요!');
      return;
    }

    // 파일 전송을 위한 폼 데이터 생성
    const formData = new FormData();
    // 주의: 'audio_file'은 FastAPI의 매개변수명과 반드시 일치해야 합니다.
    formData.append('audio_file', selectedFile); 

    setAnalyzing(true);
    setError(null);

    try {
      // 백엔드 API 호출 (로컬 테스트 기준)
      const response = await axios.post('http://localhost:8000/api/analyze-voice', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // 3. 응답 처리
      if (response.data.status === 'success') {
        setStressResult(response.data.result); // 예: 'NEUTRAL', 'SADNESS' 등
      } else {
        setError(response.data.message || '분석 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error('API 연동 에러:', err);
      setError('서버와 연결할 수 없습니다. 백엔드 서버가 켜져 있는지 확인해주세요.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', maxWidth: '400px' }}>
      <h3>🎙️ 실시간 스트레스 분석기</h3>
      
      <div style={{ marginBottom: '15px' }}>
        <input 
          type="file" 
          accept="audio/*" 
          onChange={handleFileChange} 
          disabled={analyzing}
        />
      </div>

      <button 
        onClick={handleAnalyzeClick} 
        disabled={!selectedFile || analyzing}
        style={{ padding: '10px 15px', cursor: 'pointer' }}
      >
        {analyzing ? 'AI 분석 중...' : '결과 분석하기'}
      </button>

      {/* 에러 메시지 표시 */}
      {error && <p style={{ color: 'red', marginTop: '15px' }}>{error}</p>}

      {/* 분석 결과 표시 */}
      {stressResult && (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '8px' }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>AI 분석 결과:</p>
          <p style={{ fontSize: '1.5rem', color: '#0056b3', margin: '5px 0' }}>{stressResult}</p>
        </div>
      )}
    </div>
  );
}