import {useExtensionI18n} from './messages';
export type AnswerView={answer?:string;originalAnswer?:string;answerTranslationPending?:boolean;answerTranslationFailed?:boolean};
export function answerForEditing(group?:AnswerView){return group?.originalAnswer??group?.answer??'';}
export function ApprovedAnswer({group}:{group:AnswerView}){
 const {t}=useExtensionI18n();
 if(group.answerTranslationFailed)return <p className="help" role="status">{t('Answer translation failed. Waiting for a retry.')}</p>;
 if(group.answerTranslationPending)return <p className="help" role="status">{t('Translating the approved answer…')}</p>;
 return group.answer?<blockquote>{group.answer}</blockquote>:null;
}
