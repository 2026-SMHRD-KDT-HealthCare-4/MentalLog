// 스트레스 수치(0~100)를 원형 UI 색상 클래스로 변환
export function circleClass(val) {
  if (val < 40) return 'c-green'
  if (val < 60) return 'c-yellow'
  if (val < 75) return 'c-orange'
  return 'c-red'
}
