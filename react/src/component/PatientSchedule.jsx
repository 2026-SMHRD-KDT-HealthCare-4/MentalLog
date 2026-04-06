import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import '../styles/monitor.css'

const API = 'http://localhost:3001'

const SCHEDULE_DATA = {
  scheduled: [
    { time: '12:30', name: '김망나뇽', age: 100, questionnaire: true,  count: 3 },
    { time: '13:00', name: '박망나뇽', age: 100, questionnaire: false, count: 3 },
    { time: '13:30', name: '박망나뇽', age: 132, questionnaire: false, count: 1 },
    { time: '14:00', name: '조망나뇽', age: 102, questionnaire: false, count: 2 },
    { time: '14:30', name: '양망나뇽', age: 98,  questionnaire: false, count: 1 },
    { time: '15:00', name: '김나연',   age: 120, questionnaire: false, count: 1 },
    { time: '16:00', name: '조민주',   age: 170, questionnaire: false, count: 2 },
    { time: '16:30', name: '문하눟',   age: 200, questionnaire: false, count: 1 },
  ],
  reserved: [
    { time: '12:30', name: '김망나뇽', age: 100, questionnaire: true,  count: 3 },
    { time: '14:00', name: '조망나뇽', age: 102, questionnaire: false, count: 2 },
    { time: '14:30', name: '양망나뇽', age: 98,  questionnaire: false, count: 1 },
    { time: '15:00', name: '김나연',   age: 120, questionnaire: false, count: 1 },
    { time: '16:30', name: '문하눟',   age: 200, questionnaire: false, count: 1 },
    { time: '16:00', name: '조민주',   age: 170, questionnaire: false, count: 2 },
  ],
  walk_in: [
    { time: '13:00', name: '박망나뇽', age: 100, questionnaire: false, count: 3 },
    { time: '13:30', name: '최망나뇽', age: 132, questionnaire: false, count: 1 },
  ],
}

const HISTORY_DATA = {
  this_week: ['김할머니', '김할아버지', '왕할머니', '누구누구할아버지', '할아버지망나뇽'],
  one_week:  ['김할머니', '김할아버지', '왕할머니', '누구누구할아버지', '할아버지망나뇽...'],
  one_month: ['김할머니', '김할아버지', '왕할머니', '누구누구할아버지', '할아버지망나뇽'],
}

const PAT_ID_MAP = {
  '김망나뇽': 'P001', '박망나뇽': 'P002', '최망나뇽': 'P003',
  '조망나뇽': 'P004', '양망나뇽': 'P005', '김나연': 'P006',
  '조민주': 'P007', '문하눟': 'P008',
}

function ScheduleRow({ num, item, onClick }) {
  return (
    <div className="schedule-row" onClick={onClick}>
      <span className="schedule-row-num">{num}</span>
      <div className="schedule-row-content">
        <span className="time">{'{' + item.time + '}'}</span>
        {' / '}
        <span className="name">{item.name}</span>
        {' / '}
        {item.age}세
        {' / '}
        문진{' '}
        <span className={item.questionnaire ? 'badge-o' : 'badge-x'}>
          {item.questionnaire ? 'O' : 'X'}
        </span>
        {' / '}
        {item.count}회차
      </div>
    </div>
  )
}

const PatientSchedule = () => {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [showDrop, setShowDrop] = useState(false)
  const searchRef = useRef(null)

  const allPatients = [...new Set([
    ...SCHEDULE_DATA.scheduled.map(p => p.name),
    ...SCHEDULE_DATA.reserved.map(p => p.name),
    ...SCHEDULE_DATA.walk_in.map(p => p.name),
  ])]

  const filtered = search.length > 0
    ? allPatients.filter(n => n.includes(search))
    : []

  const handlePatientClick = (name) => {
    const patId = PAT_ID_MAP[name] || 'P001'
    navigate(`/monitor/${patId}`)
  }

  const handleRowClick = (name) => {
    handlePatientClick(name)
  }

  return (
    <div className="schedule-page" onClick={() => setShowDrop(false)}>
      <div className="schedule-brand">MentalLog</div>

      {/* 검색 바 */}
      <div className="schedule-search-row" onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <input
            ref={searchRef}
            className="schedule-search-input"
            placeholder="환자 검색..."
            value={search}
            onChange={e => { setSearch(e.target.value); setShowDrop(true) }}
            onFocus={() => search && setShowDrop(true)}
          />
          {showDrop && filtered.length > 0 && (
            <div className="search-dropdown">
              {filtered.map(name => (
                <div
                  key={name}
                  className="search-dropdown-item"
                  onClick={() => { setSearch(name); setShowDrop(false); handlePatientClick(name) }}
                >
                  {name}
                  <span style={{ float: 'right', fontSize: 11, color: '#AAA' }}>
                    비슷한 이름 환자 하위로 출력
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3열 + 사이드바 */}
      <div className="schedule-grid">
        {/* 환자 스케줄 */}
        <div className="schedule-column">
          <div className="schedule-col-header">환자 스케줄</div>
          {SCHEDULE_DATA.scheduled.map((item, i) => (
            <ScheduleRow key={i} num={i + 1} item={item} onClick={() => handleRowClick(item.name)} />
          ))}
        </div>

        {/* 예약 환자 */}
        <div className="schedule-column">
          <div className="schedule-col-header">예약 환자</div>
          {SCHEDULE_DATA.reserved.map((item, i) => (
            <ScheduleRow key={i} num={i + 1} item={item} onClick={() => handleRowClick(item.name)} />
          ))}
        </div>

        {/* 비예약 환자 */}
        <div className="schedule-column">
          <div className="schedule-col-header">비예약 환자</div>
          {SCHEDULE_DATA.walk_in.map((item, i) => (
            <ScheduleRow key={i} num={i + 1} item={item} onClick={() => handleRowClick(item.name)} />
          ))}
        </div>

        {/* 과거 진료기록 사이드바 */}
        <div className="history-sidebar">
          <div className="history-sidebar-header">과거 진료기록</div>
          <div className="history-group">
            <div className="history-group-title">이번 주</div>
            {HISTORY_DATA.this_week.map((name, i) => (
              <div key={i} className="history-patient-item" onClick={() => handlePatientClick(name)}>
                {name}
              </div>
            ))}
          </div>
          <div className="history-group">
            <div className="history-group-title">1주 전</div>
            {HISTORY_DATA.one_week.map((name, i) => (
              <div key={i} className="history-patient-item" onClick={() => handlePatientClick(name)}>
                {name}
              </div>
            ))}
          </div>
          <div className="history-group">
            <div className="history-group-title">1달 전</div>
            {HISTORY_DATA.one_month.map((name, i) => (
              <div key={i} className="history-patient-item" onClick={() => handlePatientClick(name)}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PatientSchedule
